// raw(KENCIS 인증) + mapping(사람이 관리) → 배포용 데이터셋 산출.
//
//   data/models.json      풀 스키마 — 기종별 인증 이력 연결
//   data/models.min.json  경량판 — 자동완성용 한글 표기 배열
//   data/unmapped.json    시드에 매핑되지 않은 인증 차명 — 기여 대상 목록
//
// 사용: node scripts/build.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const imp = JSON.parse(readFileSync('data/raw/kencis-import.json', 'utf8'));
const dom = JSON.parse(readFileSync('data/raw/kencis-domestic.json', 'utf8'));
const offices = JSON.parse(readFileSync('mapping/offices.json', 'utf8'));
const seed = JSON.parse(readFileSync('mapping/models.json', 'utf8'));

const rows = [...imp.map((r) => ({ ...r, _gubun: 'import' })), ...dom.map((r) => ({ ...r, _gubun: 'domestic' }))];

// 비교용 정규화 — 대문자화 + 영숫자·한글만
const norm = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');

// 시드 항목마다 매칭 토큰 준비: 모델부 전체 + 영숫자 토큰(3자 이상)
const entries = seed.map((s) => {
  const token = norm(s.model);
  const alphaTokens = (s.model.match(/[A-Za-z0-9-]{3,}/g) ?? []).map(norm).filter((t) => t.length >= 3);
  return {
    ...s,
    _token: token,
    _alpha: alphaTokens,
    // 사람이 매핑한 인증 차명 — 정확 일치로 우선 매칭 (형식코드 ↔ 소비자명 연결)
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
    // 모델의 영숫자 토큰이 모두 차명에 있으면 매칭
    const hit =
      e._aliasNorm.has(nm) ||
      (e._token.length >= 3 && nm.includes(e._token)) ||
      (e._alpha.length > 0 && e._alpha.every((t) => nm.includes(t)));
    if (hit) {
      e.aliases.add(r.VEH_NM);
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

const models = entries
  .map((e) => {
    const dates = e.certifications.map((c) => c.date).filter(Boolean).sort();
    return {
      nameKo: e.nameKo,
      brand: e.brand,
      model: e.model,
      status: e.certifications.length ? 'verified' : 'curated',
      aliases: [...e.aliases].sort(),
      firstCertifiedAt: dates[0] ?? null,
      lastCertifiedAt: dates[dates.length - 1] ?? null,
      certifications: e.certifications.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    };
  })
  .sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko'));

// 미매핑 인증 차명 — 업체·건수·브랜드 후보와 함께 기여 목록으로
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
writeFileSync(
  'data/models.min.json',
  JSON.stringify({ meta: { generatedAt: meta.generatedAt, models: models.length }, names: models.map((m) => m.nameKo) }),
);
writeFileSync('data/unmapped.json', JSON.stringify({ meta, unmapped }, null, 1));

console.log(`models: ${meta.counts.models} (verified ${meta.counts.verified} / curated ${meta.counts.curated})`);
console.log(`인증 원본 ${meta.counts.certifications}건 중 미매핑 차명 ${meta.counts.unmapped}개 → data/unmapped.json`);
