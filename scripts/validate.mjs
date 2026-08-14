// 매핑·산출물 무결성 검증 (CI 에서 실행)
import { readFileSync } from 'node:fs';

let fail = 0;
const err = (m) => { console.error('✗ ' + m); fail++; };
const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const seed = load('mapping/models.json');
const imported = load('data/raw/kencis-import.json');
const domestic = load('data/raw/kencis-domestic.json');
const built = load('data/models.json');
const lite = load('data/models.lite.json');
const min = load('data/models.min.json');
const review = load('data/unmapped.json');

// 3륜·4륜은 차체 형태 분류다 — 이륜차 인증을 받지만 바퀴가 셋(화물 삼륜 등)
// 또는 넷(ATV, 사이클카트)인 차종이라 나머지 장르 분류로는 표현할 수 없다.
const CATEGORIES = new Set([
  '스포츠', '네이키드', '크루저', '투어러', '어드벤처', '스쿠터',
  '언더본', '오프로드', '클래식', '미니', '3륜', '4륜',
]);
const ROMAN_BASE = 0x2160;
const norm = (s) =>
  s.toUpperCase()
    .replace(/[Ⅰ-Ⅻ]/g, (c) => String(c.codePointAt(0) - ROMAN_BASE + 1))
    .replace(/[^A-Z0-9가-힣]/g, '');

const seen = new Set();
const aliasOwners = new Map();
for (const s of seed) {
  if (typeof s.nameKo !== 'string' || typeof s.brand !== 'string' || typeof s.model !== 'string' ||
      !s.nameKo || !s.brand || !s.model) {
    err(`필수 필드 누락 또는 타입 오류: ${JSON.stringify(s)}`);
    continue;
  }
  // 단일어 상품(브랜드=제품명, 예: 플레타)은 nameKo === brand === model 을 허용
  const single = s.nameKo === s.brand && s.model === s.brand;
  if (!single && s.nameKo !== `${s.brand} ${s.model}`) err(`nameKo 불일치: ${s.nameKo}`);
  if (seen.has(s.nameKo)) err(`중복: ${s.nameKo}`);
  seen.add(s.nameKo);
  if (s.category != null && !CATEGORIES.has(s.category)) err(`허용 밖 category: ${s.nameKo} (${s.category})`);
  if (typeof s.electric !== 'boolean') err(`electric 타입 오류: ${s.nameKo} (${s.electric})`);
  if (s.displacement != null && (!Number.isInteger(s.displacement) || s.displacement <= 0)) {
    err(`displacement 이상: ${s.nameKo} (${s.displacement})`);
  }
  if (s.electric === true && s.displacement != null) err(`전기인데 배기량 존재: ${s.nameKo}`);
  if (s.fuelGrade != null && s.fuelGrade !== 'regular' && s.fuelGrade !== 'premium') {
    err(`fuelGrade 이상: ${s.nameKo} (${s.fuelGrade})`);
  }
  if (s.electric === true && s.fuelGrade != null) err(`전기인데 fuelGrade 존재: ${s.nameKo}`);
  for (const k of ['seatHeight', 'weight', 'power']) {
    if (s[k] != null && (!Number.isInteger(s[k]) || s[k] <= 0)) err(`${k} 이상: ${s.nameKo} (${s[k]})`);
  }
  if (s.cylinders != null && ![1, 2, 3, 4, 6].includes(s.cylinders)) err(`cylinders 이상: ${s.nameKo} (${s.cylinders})`);
  if (s.cooling != null && !['air', 'liquid', 'oil'].includes(s.cooling)) err(`cooling 이상: ${s.nameKo} (${s.cooling})`);
  if (s.fuelCapacity != null && (!Number.isFinite(s.fuelCapacity) || s.fuelCapacity <= 0)) {
    err(`fuelCapacity 이상: ${s.nameKo} (${s.fuelCapacity})`);
  }
  if (s.electric === true) {
    for (const k of ['cylinders', 'cooling', 'fuelCapacity', 'power']) {
      if (s[k] != null) err(`전기인데 ${k} 존재: ${s.nameKo}`);
    }
  }

  if (s.aliases != null && !Array.isArray(s.aliases)) {
    err(`aliases 배열 아님: ${s.nameKo}`);
  } else {
    for (const alias of s.aliases ?? []) {
      if (typeof alias !== 'string' || !alias.trim()) {
        err(`빈 aliases 값: ${s.nameKo}`);
        continue;
      }
      const parts = alias.split('@');
      if (parts.length > 2 || !parts[0].trim() || (parts.length === 2 && !parts[1].trim())) {
        err(`aliases 형식 오류: ${s.nameKo} (${alias})`);
        continue;
      }
      const aliasNorm = norm(parts[0]);
      if (!aliasNorm) {
        err(`aliases 정규화 결과가 비어 있음: ${s.nameKo} (${alias})`);
        continue;
      }
      const key = `${aliasNorm}@${(parts[1] ?? '').trim().toUpperCase()}`;
      const owner = aliasOwners.get(key);
      if (owner && owner !== s.nameKo) err(`aliases 충돌: ${alias} (${owner}, ${s.nameKo})`);
      aliasOwners.set(key, s.nameKo);
    }
  }
}

if (!Array.isArray(imported) || !Array.isArray(domestic)) err('KENCIS 원본은 배열이어야 합니다');
if (!Array.isArray(built.models)) err('models.json models는 배열이어야 합니다');
if (!Array.isArray(lite.models)) err('models.lite.json models는 배열이어야 합니다');
if (!Array.isArray(min.names)) err('models.min.json names는 배열이어야 합니다');
if (!Array.isArray(review.unmapped) || !Array.isArray(review.ambiguous) || !Array.isArray(review.excluded)) {
  err('unmapped.json의 unmapped/ambiguous/excluded는 배열이어야 합니다');
}

if (built.models.length !== seed.length) err(`산출물 수 불일치: seed ${seed.length} vs built ${built.models.length}`);
if (lite.models.length !== seed.length) err(`lite 산출물 수 불일치: seed ${seed.length} vs lite ${lite.models.length}`);
if (min.names.length !== seed.length) err(`min 산출물 수 불일치: seed ${seed.length} vs min ${min.names.length}`);
if (!same(min.names, built.models.map((m) => m.nameKo))) err('min 이름 목록이 models.json과 다릅니다');
if (!same(lite.meta, built.meta) || !same(review.meta, built.meta)) err('산출물 meta가 서로 다릅니다');
if (!same(min.meta, { generatedAt: built.meta.generatedAt, models: built.models.length })) err('min meta가 models.json과 다릅니다');

for (let i = 0; i < built.models.length; i++) {
  const full = built.models[i];
  const summary = lite.models[i];
  const { certifications, ...rest } = full;
  const expected = {
    ...rest,
    certificationCount: certifications.length,
    offices: [...new Set(certifications.map((c) => c.office))],
  };
  if (!same(summary, expected)) {
    err(`lite 산출물 불일치: ${full.nameKo}`);
    break;
  }
  const expectedStatus = certifications.length ? 'verified' : 'curated';
  if (full.status !== expectedStatus) err(`status 불일치: ${full.nameKo} (${full.status} vs ${expectedStatus})`);
}

// 모든 원본 인증행은 정확히 한 버킷으로 가야 한다. 이 등식이 깨지면 매처가
// 인증을 중복 귀속했거나 조용히 버린 것이므로 배포를 막는다.
const rawRows = imported.length + domestic.length;
const mappedRows = built.models.reduce((sum, m) => sum + m.certifications.length, 0);
const unmappedRows = review.unmapped.reduce((sum, x) => sum + x.count, 0);
const ambiguousRows = review.ambiguous.reduce((sum, x) => sum + x.count, 0);
const excludedRows = review.excluded.reduce((sum, x) => sum + x.count, 0);
const accountedRows = mappedRows + unmappedRows + ambiguousRows + excludedRows;
if (rawRows !== accountedRows) {
  err(`인증행 보존 실패: raw ${rawRows} vs mapped ${mappedRows} + unmapped ${unmappedRows} + ambiguous ${ambiguousRows} + excluded ${excludedRows}`);
}

const expectedCounts = {
  models: built.models.length,
  verified: built.models.filter((m) => m.status === 'verified').length,
  curated: built.models.filter((m) => m.status === 'curated').length,
  certifications: rawRows,
  unmapped: review.unmapped.length,
  ambiguous: review.ambiguous.length,
  excluded: review.excluded.length,
};
if (!same(built.meta.counts, expectedCounts)) {
  err(`meta.counts 불일치: ${JSON.stringify(built.meta.counts)} vs ${JSON.stringify(expectedCounts)}`);
}

if (fail) { console.error(`${fail}건 실패`); process.exit(1); }
console.log(`✓ 시드 ${seed.length}종, 원본 인증 ${rawRows}행 전부 정합 OK`);
