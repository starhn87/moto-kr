// 매핑·산출물 무결성 검증 (CI 에서 실행)
import { readFileSync } from 'node:fs';

let fail = 0;
const err = (m) => { console.error('✗ ' + m); fail++; };

const seed = JSON.parse(readFileSync('mapping/models.json', 'utf8'));
const seen = new Set();
for (const s of seed) {
  if (!s.nameKo || !s.brand || !s.model) err(`필수 필드 누락: ${JSON.stringify(s)}`);
  if (s.nameKo !== `${s.brand} ${s.model}`) err(`nameKo 불일치: ${s.nameKo}`);
  if (seen.has(s.nameKo)) err(`중복: ${s.nameKo}`);
  seen.add(s.nameKo);
}

const built = JSON.parse(readFileSync('data/models.json', 'utf8'));
if (built.models.length !== seed.length) err(`산출물 수 불일치: seed ${seed.length} vs built ${built.models.length}`);

const min = JSON.parse(readFileSync('data/models.min.json', 'utf8'));
if (min.names.length !== seed.length) err(`min 산출물 수 불일치`);

if (fail) { console.error(`${fail}건 실패`); process.exit(1); }
console.log(`✓ 시드 ${seed.length}종, 산출물 정합 OK`);
