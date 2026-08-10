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

// 비교용 정규화: 대문자화 + 영숫자·한글만. 로마숫자(Ⅱ 등)는 아라비아 숫자로
// 바꾼다 — 그냥 지우면 "TOYOUDAYⅡ"가 "TOYOUDAY"와 같아져 별칭이 충돌한다.
const ROMAN_BASE = 0x2160; // Ⅰ
const norm = (s) =>
  (s ?? '')
    .toUpperCase()
    .replace(/[Ⅰ-Ⅻ]/g, (c) => String(c.codePointAt(0) - ROMAN_BASE + 1))
    .replace(/[^A-Z0-9가-힣]/g, '');

// 시드 항목마다 매칭 토큰 준비: 모델부 전체 + 영숫자 토큰(3자 이상)
const entries = seed.map((s) => {
  const token = norm(s.model);
  // 짧거나 숫자로 시작하는 토큰은 증거력이 없어 제외한다 — "S125"가 VESPA SPRINT S 125 를,
  // "250R"이 타사 250R 차명을, "125i"가 온갖 125i 스쿠터를 흡수하는 오매칭 방지.
  // 그런 기종은 별칭(정확 일치)으로 사람이 확정한다.
  const alphaTokens = (s.model.match(/[A-Za-z0-9-]{3,}/g) ?? [])
    .map(norm)
    .filter((t) => t.length >= 5 && !/^[0-9]/.test(t));
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

// 인증 차명이 모델 토큰을 포함하면(예: CBR650RA ⊇ CBR650R) 매칭 후보가 된다.
// 경계 규칙 둘:
//  - 오른쪽: 토큰이 숫자로 끝나면 바로 뒤가 숫자면 안 된다 — R12 가 R1250GS 를,
//    닌자400 이 ...4000 을 흡수하는 오매칭 방지 (사양 접미 문자는 허용)
//  - 왼쪽: 매칭은 원문 단어의 시작에서만 인정한다 — T100 이 AT100R(대림)을,
//    C125 가 NXC125(야마하)를 단어 중간에서 흡수하는 오매칭 방지.
//    "BMW R 1250 GS" 처럼 띄어 쓴 차명은 각 단어 시작이 경계가 된다.
const boundedIncludes = (hay, needle, wordStarts) => {
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    const nextCh = hay[idx + needle.length];
    const rightOk = !(/[0-9]$/.test(needle) && nextCh && /[0-9]/.test(nextCh));
    const leftOk = !wordStarts || wordStarts.has(idx);
    if (rightOk && leftOk) return true;
    idx = hay.indexOf(needle, idx + 1);
  }
  return false;
};

// 정규화된 차명에서 "원문 단어의 시작"에 해당하는 인덱스 집합.
// 공백·기호가 경계이고, 한글↔영숫자 전환도 경계로 본다("메가빅스MV125"의 MV 등).
const wordStartsOf = (raw) => {
  const expanded = (raw ?? '').toUpperCase().replace(/[Ⅰ-Ⅻ]/g, (c) => String(c.codePointAt(0) - ROMAN_BASE + 1));
  const starts = new Set();
  let pos = 0;
  let prev = null; // null=경계, 'L'=영숫자, 'K'=한글
  for (const ch of expanded) {
    const type = /[A-Z0-9]/.test(ch) ? 'L' : /[가-힣]/.test(ch) ? 'K' : null;
    if (type === null) {
      prev = null;
      continue;
    }
    if (prev !== type) starts.add(pos);
    prev = type;
    pos++;
  }
  return starts;
};

// 한 인증은 정확히 한 기종에만 귀속한다. 포함 매칭을 후보 전원에 뿌리면
// "BMW R 1250 R"이 250R 토큰의 닌자250R에도 계상되는 식으로 중복이 쌓인다.
// 우선순위: 사람이 확정한 별칭 정확 일치 > 더 길게(구체적으로) 일치한 토큰.
// 동점이면 어느 쪽도 갖지 않고 검토 목록(ambiguous)으로 보낸다 — 별칭을
// 추가해 사람이 확정하는 게 이 저장소의 매핑 절차다.
const ALIAS_SCORE = 1000;
const scoreOf = (e, nm, wordStarts) => {
  if (e._aliasNorm.has(nm)) return ALIAS_SCORE;
  let score = -1;
  // 순수 숫자 모델명("848")의 포함 매칭은 배기량 숫자까지 흡수하므로 정확 일치만 허용
  if (e._token.length >= 3 && (/[^0-9]/.test(e._token) ? boundedIncludes(nm, e._token, wordStarts) : nm === e._token)) {
    score = e._token.length;
  }
  if (e._alpha.length > 0 && e._alpha.every((t) => boundedIncludes(nm, t, wordStarts))) {
    score = Math.max(score, e._alpha.reduce((a, t) => a + t.length, 0));
  }
  return score;
};

const matchedRowIdx = new Set();
const ambiguousMap = new Map();
rows.forEach((r, i) => {
  const nm = norm(r.VEH_NM);
  if (!nm) return;
  const wordStarts = wordStartsOf(r.VEH_NM);
  let bestScore = -1;
  let best = [];
  for (const e of entries) {
    const score = scoreOf(e, nm, wordStarts);
    if (score < 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = [e];
    } else if (score === bestScore) {
      best.push(e);
    }
  }
  if (best.length === 0) return; // 미매핑 — unmapped 로
  if (best.length > 1) {
    matchedRowIdx.add(i); // unmapped 와 이중 계상 방지
    const cur = ambiguousMap.get(r.VEH_NM) ?? {
      vehNm: r.VEH_NM,
      office: r.OFFICE_NM,
      candidates: best.map((e) => e.nameKo).sort(),
      count: 0,
      lastDate: null,
    };
    cur.count++;
    const d = (r.EMIS_CERTI_DATE ?? r.NOISE_CERTI_DATE ?? '').replaceAll('/', '-');
    if (d && (!cur.lastDate || d > cur.lastDate)) cur.lastDate = d;
    ambiguousMap.set(r.VEH_NM, cur);
    return;
  }
  const e = best[0];
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
});
const ambiguous = [...ambiguousMap.values()].sort((a, b) => {
  const da = a.lastDate ?? '';
  const db = b.lastDate ?? '';
  if (da !== db) return da < db ? 1 : -1;
  return a.vehNm < b.vehNm ? -1 : a.vehNm > b.vehNm ? 1 : 0;
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
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
        return latest ? euroOf(latest.mustard, latest.date) : null;
      })(),
      status: e.certifications.length ? 'verified' : 'curated',
      aliases: [...e.aliases].sort(),
      firstCertifiedAt: dates[0] ?? null,
      lastCertifiedAt: dates[dates.length - 1] ?? null,
      certifications: e.certifications.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0)),
    };
  })
  .sort((a, b) => (a.nameKo < b.nameKo ? -1 : a.nameKo > b.nameKo ? 1 : 0));

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
const unmapped = [...unmappedMap.values()].sort((a, b) => {
  const da = a.lastDate ?? '';
  const db = b.lastDate ?? '';
  if (da !== db) return da < db ? 1 : -1;
  return a.vehNm < b.vehNm ? -1 : a.vehNm > b.vehNm ? 1 : 0;
});

// 내용이 그대로면 기존 날짜를 유지한다 — 같은 입력이면 출력도 같아야
// CI 의 "build output committed" 검증이 다음 날 날짜만으로 깨지지 않는다.
let prev = null;
let prevUnmapped = null;
try {
  prev = JSON.parse(readFileSync('data/models.json', 'utf8'));
  prevUnmapped = JSON.parse(readFileSync('data/unmapped.json', 'utf8'));
} catch {
  // 첫 빌드 — 오늘 날짜로 간다
}
const unchanged =
  prev &&
  prevUnmapped &&
  JSON.stringify(prev.models) === JSON.stringify(models) &&
  JSON.stringify(prevUnmapped.unmapped) === JSON.stringify(unmapped) &&
  JSON.stringify(prevUnmapped.ambiguous ?? []) === JSON.stringify(ambiguous);

const meta = {
  generatedAt: unchanged ? prev.meta.generatedAt : new Date().toISOString().slice(0, 10),
  source: 'KENCIS 자동차 배출가스·소음 인증 (data.go.kr 15000988)',
  counts: {
    models: models.length,
    verified: models.filter((m) => m.status === 'verified').length,
    curated: models.filter((m) => m.status === 'curated').length,
    certifications: rows.length,
    unmapped: unmapped.length,
    ambiguous: ambiguous.length,
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
writeFileSync('data/unmapped.json', JSON.stringify({ meta, unmapped, ambiguous }, null, 1));

console.log(`models: ${meta.counts.models} (verified ${meta.counts.verified} / curated ${meta.counts.curated})`);
console.log(`인증 원본 ${meta.counts.certifications}건 중 미매핑 차명 ${meta.counts.unmapped}개 → data/unmapped.json`);
console.log(`매칭 동점으로 보류된 차명 ${meta.counts.ambiguous}개 → data/unmapped.json (ambiguous) — 별칭 추가로 확정 필요`);
