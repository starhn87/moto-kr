// raw(KENCIS 인증)와 mapping(사람이 관리)을 합쳐 배포용 데이터셋을 만든다.
//
//   data/models.json       풀 스키마: 기종별 인증 이력 전문
//   data/models.lite.json   경량판: 인증 이력 대신 요약(건수·업체). 쿼리 API 가 임베드
//   data/models.min.json    최소판: 자동완성용 한글 표기 배열
//   data/unmapped.json      시드에 매핑되지 않은 인증 차명: 기여 대상 목록
//
// 사용: node scripts/build.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const imp = JSON.parse(readFileSync('data/raw/kencis-import.json', 'utf8'));
const dom = JSON.parse(readFileSync('data/raw/kencis-domestic.json', 'utf8'));
const offices = JSON.parse(readFileSync('mapping/offices.json', 'utf8'));
const seed = JSON.parse(readFileSync('mapping/models.json', 'utf8'));

const rows = [...imp.map((r) => ({ ...r, _gubun: 'import' })), ...dom.map((r) => ({ ...r, _gubun: 'domestic' }))];

// 비교용 정규화: 대문자화 + 영숫자·한글만
const norm = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');

// 시드 항목마다 매칭 토큰 준비: 모델부 전체 + 영숫자 토큰(3자 이상)
const entries = seed.map((s) => {
  const token = norm(s.model);
  // 순수 숫자 토큰은 배기량 숫자라 다른 브랜드 차명까지 흡수한다("650" → AN650, C650...) — 제외
  const alphaTokens = (s.model.match(/[A-Za-z0-9-]{3,}/g) ?? [])
    .map(norm)
    .filter((t) => t.length >= 3 && !/^[0-9]+$/.test(t));
  return {
    ...s,
    _token: token,
    _alpha: alphaTokens,
    // 사람이 매핑한 인증 차명: 정확 일치로 우선 매칭 (형식코드를 소비자명에 연결)
    _aliasNorm: new Set((s.aliases ?? []).map(norm).filter(Boolean)),
    aliases: new Set(s.aliases ?? []),
    certifications: [],
  };
});

const matchedRowIdx = new Set();
rows.forEach((r, i) => {
  const nm = norm(r.VEH_NM);
  if (!nm) return;
  for (const e of entries) {
    // 인증 차명이 모델 토큰을 포함하거나(예: CBR650RA ⊇ CBR650R),
    // 모델의 영숫자 토큰이 모두 차명에 있으면 매칭.
    // 단 토큰이 숫자로 끝나면 바로 뒤 문자가 숫자가 아니어야 한다 — R12 가
    // R1250GS 를, 닌자400 이 ...4000 을 흡수하는 오매칭 방지 (사양 접미 문자는 허용)
    const boundedIncludes = (hay, needle) => {
      let idx = hay.indexOf(needle);
      while (idx !== -1) {
        const nextCh = hay[idx + needle.length];
        if (!(/[0-9]$/.test(needle) && nextCh && /[0-9]/.test(nextCh))) return true;
        idx = hay.indexOf(needle, idx + 1);
      }
      return false;
    };
    const hit =
      e._aliasNorm.has(nm) ||
      (e._token.length >= 3 && boundedIncludes(nm, e._token)) ||
      (e._alpha.length > 0 && e._alpha.every((t) => boundedIncludes(nm, t)));
    if (hit) {
      e.aliases.add(r.VEH_NM);
      e._emissions ??= [];
      e._emissions.push({
        date: (r.EMIS_CERTI_DATE ?? r.NOISE_CERTI_DATE ?? '').replaceAll('/', '-'),
        mustard: r.MUSTARD ?? null,
      });
      e.certifications.push({
        no: r.EMIS_CERTI_NO ?? r.NOISE_CERTI_NO,
        date: (r.EMIS_CERTI_DATE ?? r.NOISE_CERTI_DATE ?? '').replaceAll('/', '-') || null,
        office: r.OFFICE_NM,
        vehNm: r.VEH_NM,
        vehType: r.VEH_TYPE,
        fuel: r.FUELTYPE,
        gubun: r._gubun,
      });
      matchedRowIdx.add(i);
    }
  }
});

// 배출 기준 유도: 최신 인증의 배출허용기준(예: "2020년 1월 기준" = 유로5)을 우선하고
// 미기재면 인증일로 근사한다 (유로4 2017.1, 유로5 2020.1 시행)
const euroOf = (mustard, date) => {
  const y = Number((mustard?.match(/(20\d{2})년/) ?? [])[1] ?? 0);
  if (y >= 2020) return 'euro5';
  if (y >= 2017) return 'euro4';
  if (y >= 2006) return 'euro3';
  const dy = Number((date ?? '').slice(0, 4)) || 0;
  if (dy >= 2021) return 'euro5';
  if (dy >= 2017) return 'euro4';
  if (dy >= 2008) return 'euro3';
  return null;
};

const models = entries
  .map((e) => {
    const dates = e.certifications.map((c) => c.date).filter(Boolean).sort();
    return {
      nameKo: e.nameKo,
      brand: e.brand,
      model: e.model,
      displacement: e.displacement ?? null,
      category: e.category ?? null,
      electric: e.electric ?? false,
      fuelGrade: e.fuelGrade ?? null,
      seatHeight: e.seatHeight ?? null,
      weight: e.weight ?? null,
      cylinders: e.cylinders ?? null,
      cooling: e.cooling ?? null,
      fuelCapacity: e.fuelCapacity ?? null,
      power: e.power ?? null,
      emissionStandard: (() => {
        const latest = (e._emissions ?? [])
          .filter((x) => x.date)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        return latest ? euroOf(latest.mustard, latest.date) : null;
      })(),
      status: e.certifications.length ? 'verified' : 'curated',
      aliases: [...e.aliases].sort(),
      firstCertifiedAt: dates[0] ?? null,
      lastCertifiedAt: dates[dates.length - 1] ?? null,
      certifications: e.certifications.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    };
  })
  .sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko'));

// 미매핑 인증 차명: 업체·건수·브랜드 후보와 함께 기여 목록으로
const unmappedMap = new Map();
rows.forEach((r, i) => {
  if (matchedRowIdx.has(i)) return;
  const key = `${r.OFFICE_NM}|${r.VEH_NM}`;
  const cur = unmappedMap.get(key) ?? {
    vehNm: r.VEH_NM,
    office: r.OFFICE_NM,
    brandHint: offices[r.OFFICE_NM]?.brands ?? null,
    count: 0,
    lastDate: null,
  };
  cur.count++;
  const d = (r.EMIS_CERTI_DATE ?? r.NOISE_CERTI_DATE ?? '').replaceAll('/', '-');
  if (d && (!cur.lastDate || d > cur.lastDate)) cur.lastDate = d;
  unmappedMap.set(key, cur);
});
const unmapped = [...unmappedMap.values()].sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));

const meta = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'KENCIS 자동차 배출가스·소음 인증 (data.go.kr 15000988)',
  counts: {
    models: models.length,
    verified: models.filter((m) => m.status === 'verified').length,
    curated: models.filter((m) => m.status === 'curated').length,
    certifications: rows.length,
    unmapped: unmapped.length,
  },
};

writeFileSync('data/models.json', JSON.stringify({ meta, models }, null, 1));
const lite = models.map(({ certifications, ...rest }) => ({
  ...rest,
  certificationCount: certifications.length,
  offices: [...new Set(certifications.map((c) => c.office))],
}));
writeFileSync('data/models.lite.json', JSON.stringify({ meta, models: lite }));
writeFileSync(
  'data/models.min.json',
  JSON.stringify({ meta: { generatedAt: meta.generatedAt, models: models.length }, names: models.map((m) => m.nameKo) }),
);
writeFileSync('data/unmapped.json', JSON.stringify({ meta, unmapped }, null, 1));

console.log(`models: ${meta.counts.models} (verified ${meta.counts.verified} / curated ${meta.counts.curated})`);
console.log(`인증 원본 ${meta.counts.certifications}건 중 미매핑 차명 ${meta.counts.unmapped}개 → data/unmapped.json`);
