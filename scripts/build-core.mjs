import { normalizeVehicleName } from '../lib/model-rules.mjs';

const ALIAS_SCORE = 1000;
const TYPED_ALIAS_SCORE = 2000;

const certificationDate = (row) => (row.EMIS_CERTI_DATE ?? row.NOISE_CERTI_DATE ?? '').replaceAll('/', '-');

export const rowsOf = (imported, domestic) => [
  ...imported.map((row) => ({ ...row, _gubun: 'import' })),
  ...domestic.map((row) => ({ ...row, _gubun: 'domestic' })),
];

// 정규화된 차명에서 원문 단어의 시작에 해당하는 인덱스 집합을 만든다.
// 공백·기호와 한글↔영숫자 전환을 경계로 본다.
export const wordStartsOf = (raw) => {
  const expanded = (raw ?? '').toUpperCase().replace(/[Ⅰ-Ⅻ]/g, (character) => normalizeVehicleName(character));
  const starts = new Set();
  let position = 0;
  let previousType = null;
  for (const character of expanded) {
    const type = /[A-Z0-9]/.test(character) ? 'L' : /[가-힣]/.test(character) ? 'K' : null;
    if (type === null) {
      previousType = null;
      continue;
    }
    if (previousType !== type) starts.add(position);
    previousType = type;
    position++;
  }
  return starts;
};

export const boundedIncludes = (haystack, needle, wordStarts) => {
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const nextCharacter = haystack[index + needle.length];
    const rightOk = !(/[0-9]$/.test(needle) && nextCharacter && /[0-9]/.test(nextCharacter));
    const leftOk = !wordStarts || wordStarts.has(index);
    if (rightOk && leftOk) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
};

const prepareEntries = (seed) =>
  seed.map((model) => {
    const token = normalizeVehicleName(model.model);
    const alphaTokens = (model.model.match(/[A-Za-z0-9-]{3,}/g) ?? [])
      .map(normalizeVehicleName)
      .filter((candidate) => candidate.length >= 5 && !/^[0-9]/.test(candidate));
    const aliasNorm = new Set();
    const aliasTyped = new Map();
    for (const alias of model.aliases ?? []) {
      const separator = alias.indexOf('@');
      if (separator === -1) {
        const normalized = normalizeVehicleName(alias);
        if (normalized) aliasNorm.add(normalized);
        continue;
      }
      const normalized = normalizeVehicleName(alias.slice(0, separator));
      const vehicleType = alias.slice(separator + 1).trim().toUpperCase();
      if (!normalized || !vehicleType) continue;
      if (!aliasTyped.has(normalized)) aliasTyped.set(normalized, new Set());
      aliasTyped.get(normalized).add(vehicleType);
    }
    return {
      ...model,
      _token: token,
      _alpha: alphaTokens,
      _aliasNorm: aliasNorm,
      _aliasTyped: aliasTyped,
      aliases: new Set(model.aliases ?? []),
      certifications: [],
    };
  });

export const scoreEntry = (entry, normalizedName, wordStarts, vehicleType) => {
  if (vehicleType && entry._aliasTyped.get(normalizedName)?.has(vehicleType)) return TYPED_ALIAS_SCORE;
  if (entry._aliasNorm.has(normalizedName)) return ALIAS_SCORE;
  let score = -1;
  if (
    entry._token.length >= 3 &&
    (/[^0-9]/.test(entry._token)
      ? boundedIncludes(normalizedName, entry._token, wordStarts)
      : normalizedName === entry._token)
  ) {
    score = entry._token.length;
  }
  if (entry._alpha.length > 0 && entry._alpha.every((token) => boundedIncludes(normalizedName, token, wordStarts))) {
    score = Math.max(
      score,
      entry._alpha.reduce((total, token) => total + token.length, 0),
    );
  }
  return score;
};

export const emissionStandardOf = (mustard, date) => {
  const standardYear = Number((mustard?.match(/(20\d{2})년/) ?? [])[1] ?? 0);
  if (standardYear >= 2020) return 'euro5';
  if (standardYear >= 2017) return 'euro4';
  if (standardYear >= 2006) return 'euro3';
  const certificationYear = Number((date ?? '').slice(0, 4)) || 0;
  if (certificationYear >= 2021) return 'euro5';
  if (certificationYear >= 2017) return 'euro4';
  if (certificationYear >= 2008) return 'euro3';
  return null;
};

export const nonVehicleReason = (vehicleName) => {
  const normalized = (vehicleName ?? '').trim();
  if (/^동일차_\d+$/.test(normalized)) return 'KENCIS 자리표시자';
  if (/^(test|테스트)/i.test(normalized)) return '시험 등록분';
  return null;
};

const byRecency = (left, right) => {
  const leftDate = left.lastDate ?? '';
  const rightDate = right.lastDate ?? '';
  if (leftDate !== rightDate) return leftDate < rightDate ? 1 : -1;
  return left.vehNm < right.vehNm ? -1 : left.vehNm > right.vehNm ? 1 : 0;
};

export const buildDataset = ({ imported, domestic, offices, seed, previousModels = null, previousReview = null, today }) => {
  const rows = rowsOf(imported, domestic);
  const entries = prepareEntries(seed);
  const matchedRowIndexes = new Set();
  const ambiguousMap = new Map();

  rows.forEach((row, index) => {
    const normalizedName = normalizeVehicleName(row.VEH_NM);
    if (!normalizedName) return;
    const wordStarts = wordStartsOf(row.VEH_NM);
    const vehicleType = (row.VEH_TYPE ?? '').trim().toUpperCase();
    let bestScore = -1;
    let bestEntries = [];
    for (const entry of entries) {
      const score = scoreEntry(entry, normalizedName, wordStarts, vehicleType);
      if (score < 0) continue;
      if (score > bestScore) {
        bestScore = score;
        bestEntries = [entry];
      } else if (score === bestScore) {
        bestEntries.push(entry);
      }
    }
    if (bestEntries.length === 0) return;
    if (bestEntries.length > 1) {
      matchedRowIndexes.add(index);
      const current = ambiguousMap.get(row.VEH_NM) ?? {
        vehNm: row.VEH_NM,
        office: row.OFFICE_NM,
        candidates: bestEntries.map((entry) => entry.nameKo).sort(),
        count: 0,
        lastDate: null,
      };
      current.count++;
      const date = certificationDate(row);
      if (date && (!current.lastDate || date > current.lastDate)) current.lastDate = date;
      ambiguousMap.set(row.VEH_NM, current);
      return;
    }

    const entry = bestEntries[0];
    entry.aliases.add(row.VEH_NM);
    entry._emissions ??= [];
    entry._emissions.push({ date: certificationDate(row), mustard: row.MUSTARD ?? null });
    entry.certifications.push({
      no: row.EMIS_CERTI_NO ?? row.NOISE_CERTI_NO,
      date: certificationDate(row) || null,
      office: row.OFFICE_NM,
      vehNm: row.VEH_NM,
      vehType: row.VEH_TYPE,
      fuel: row.FUELTYPE,
      gubun: row._gubun,
    });
    matchedRowIndexes.add(index);
  });

  const ambiguous = [...ambiguousMap.values()].sort(byRecency);
  const models = entries
    .map((entry) => {
      const dates = entry.certifications.map((certification) => certification.date).filter(Boolean).sort();
      const latestEmission = (entry._emissions ?? [])
        .filter((emission) => emission.date)
        .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0))[0];
      return {
        nameKo: entry.nameKo,
        brand: entry.brand,
        model: entry.model,
        displacement: entry.displacement ?? null,
        category: entry.category ?? null,
        electric: entry.electric ?? false,
        fuelGrade: entry.fuelGrade ?? null,
        seatHeight: entry.seatHeight ?? null,
        weight: entry.weight ?? null,
        cylinders: entry.cylinders ?? null,
        cooling: entry.cooling ?? null,
        fuelCapacity: entry.fuelCapacity ?? null,
        power: entry.power ?? null,
        emissionStandard: latestEmission ? emissionStandardOf(latestEmission.mustard, latestEmission.date) : null,
        status: entry.certifications.length ? 'verified' : 'curated',
        aliases: [...entry.aliases].sort(),
        firstCertifiedAt: dates[0] ?? null,
        lastCertifiedAt: dates[dates.length - 1] ?? null,
        certifications: entry.certifications.sort((left, right) =>
          (left.date ?? '') < (right.date ?? '') ? -1 : (left.date ?? '') > (right.date ?? '') ? 1 : 0,
        ),
      };
    })
    .sort((left, right) => (left.nameKo < right.nameKo ? -1 : left.nameKo > right.nameKo ? 1 : 0));

  const unmappedMap = new Map();
  rows.forEach((row, index) => {
    if (matchedRowIndexes.has(index)) return;
    const key = `${row.OFFICE_NM}|${row.VEH_NM}`;
    const current = unmappedMap.get(key) ?? {
      vehNm: row.VEH_NM,
      office: row.OFFICE_NM,
      brandHint: offices[row.OFFICE_NM]?.brands ?? null,
      count: 0,
      lastDate: null,
    };
    current.count++;
    const date = certificationDate(row);
    if (date && (!current.lastDate || date > current.lastDate)) current.lastDate = date;
    unmappedMap.set(key, current);
  });

  const allUnmapped = [...unmappedMap.values()];
  const unmapped = allUnmapped.filter((item) => !nonVehicleReason(item.vehNm)).sort(byRecency);
  const excluded = allUnmapped
    .filter((item) => nonVehicleReason(item.vehNm))
    .map((item) => ({ ...item, reason: nonVehicleReason(item.vehNm) }))
    .sort(byRecency);

  const unchanged =
    previousModels &&
    previousReview &&
    JSON.stringify(previousModels.models) === JSON.stringify(models) &&
    JSON.stringify(previousReview.unmapped) === JSON.stringify(unmapped) &&
    JSON.stringify(previousReview.ambiguous ?? []) === JSON.stringify(ambiguous) &&
    JSON.stringify(previousReview.excluded ?? []) === JSON.stringify(excluded);
  const generatedAt = unchanged
    ? previousModels.meta.generatedAt
    : (today ?? new Date().toISOString().slice(0, 10));
  const meta = {
    generatedAt,
    source: 'KENCIS 자동차 배출가스·소음 인증 (data.go.kr 15000988)',
    counts: {
      models: models.length,
      verified: models.filter((model) => model.status === 'verified').length,
      curated: models.filter((model) => model.status === 'curated').length,
      certifications: rows.length,
      unmapped: unmapped.length,
      ambiguous: ambiguous.length,
      excluded: excluded.length,
    },
  };
  const liteModels = models.map(({ certifications, ...rest }) => ({
    ...rest,
    certificationCount: certifications.length,
    offices: [...new Set(certifications.map((certification) => certification.office))],
  }));

  return {
    full: { meta, models },
    lite: { meta, models: liteModels },
    min: { meta: { generatedAt, models: models.length }, names: models.map((model) => model.nameKo) },
    review: { meta, unmapped, ambiguous, excluded },
  };
};
