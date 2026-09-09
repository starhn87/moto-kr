// KENCIS(환경부 자동차 배출가스·소음 인증) 오픈API에서 이륜차 인증 전량을 수집한다.
// 사용: DATA_GO_KR_KEY=<공공데이터포털 인증키> node scripts/fetch-kencis.mjs

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

import {
  assertNoUnexpectedShrink,
  compareKencisRows,
  dedupeKencisRows,
  describeRequestError,
  fetchKencisGroup,
} from './kencis-client.mjs';

const apiKey = process.env.DATA_GO_KR_KEY;
if (!apiKey) {
  console.error('DATA_GO_KR_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const onRetry = ({ page, attempt, maxAttempts, delay, error }) => {
  console.warn(
    `KENCIS 요청 실패 (page=${page}, attempt=${attempt}/${maxAttempts}): ` +
      `${describeRequestError(error)} — ${delay / 1000}초 후 재시도`,
  );
};
const onProgress = ({ gubun, fetched, total, motorcycles }) => {
  process.stdout.write(`\rgubun=${gubun} ${fetched}/${total} (이륜 ${motorcycles})`);
};
const fetchGroup = async (gubun) => {
  const rows = await fetchKencisGroup({ gubun, apiKey, onRetry, onProgress });
  console.log();
  return dedupeKencisRows(rows).sort(compareKencisRows);
};

const previousCount = (file) => {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value.length : null;
  } catch {
    return null;
  }
};
const writeAtomically = (file, rows) => {
  const temporaryFile = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryFile, JSON.stringify(rows, null, 1));
    renameSync(temporaryFile, file);
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    throw error;
  }
};

mkdirSync('data/raw', { recursive: true });

// 양쪽 API를 모두 끝까지 받은 뒤 검증하고 저장해 부분 성공으로 원본이 손상되지 않게 한다.
const imported = await fetchGroup(1);
const domestic = await fetchGroup(2);
const allowShrink = process.env.ALLOW_KENCIS_SHRINK === '1';

assertNoUnexpectedShrink('수입제작', previousCount('data/raw/kencis-import.json'), imported, allowShrink);
assertNoUnexpectedShrink('국내제작', previousCount('data/raw/kencis-domestic.json'), domestic, allowShrink);

writeAtomically('data/raw/kencis-import.json', imported);
writeAtomically('data/raw/kencis-domestic.json', domestic);

console.log(`수입제작 이륜 ${imported.length}건 → data/raw/kencis-import.json`);
console.log(`국내제작 이륜 ${domestic.length}건 → data/raw/kencis-domestic.json`);
