// KENCIS(환경부 자동차 배출가스·소음 인증) 오픈API에서 이륜차 인증 전량을 수집한다.
// 국내 판매용 이륜차는 인증이 법정 의무이므로 이 목록이 정발 기종의 공식 전수에 가장 가깝다.
//
// 사용: DATA_GO_KR_KEY=<공공데이터포털 인증키> node scripts/fetch-kencis.mjs
// 산출: data/raw/kencis-import.json (수입제작차), data/raw/kencis-domestic.json (국내제작차)
//
// API: https://www.data.go.kr/data/15000988/openapi.do (무료, 개발계정 월 1만 건)
// 주의: 차종(이륜) 필터 파라미터가 없어 전량 페이징 후 CARTYPE 로 걸러낸다.

import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) {
  console.error('DATA_GO_KR_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const BASE = 'https://apis.data.go.kr/1480523/Kencis/getVems';
const ROWS = 1000;
const MAX_ATTEMPTS = 3;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(url, page) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status} (page ${page}, attempt ${attempt})`);
        if (res.status !== 429 && res.status < 500) {
          error.retryable = false;
          throw error;
        }
        lastError = error;
      } else {
        return await res.json();
      }
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
    }
    if (attempt < MAX_ATTEMPTS) await wait(500 * 2 ** (attempt - 1));
  }
  throw lastError;
}

async function fetchAll(gubun) {
  const out = [];
  let total = null;
  let fetched = 0;
  for (let page = 1; ; page++) {
    const url = `${BASE}?serviceKey=${KEY}&pageNo=${page}&numOfRows=${ROWS}&resultType=json&gubun=${gubun}`;
    const body = await fetchPage(url, page);
    const v = body.getVems;
    if (v?.header?.code && v.header.code !== '00') {
      throw new Error(`API error: ${v.header.code} ${v.header.message}`);
    }
    const pageTotal = Number(v?.totalCount);
    if (!Number.isSafeInteger(pageTotal) || pageTotal < 0) {
      throw new Error(`API totalCount 이상: ${v?.totalCount} (gubun=${gubun}, page=${page})`);
    }
    if (total === null) total = pageTotal;
    if (pageTotal !== total) {
      throw new Error(`수집 중 totalCount 변경: ${total} → ${pageTotal} (gubun=${gubun}, page=${page})`);
    }
    const items = Array.isArray(v.item) ? v.item : v.item ? [v.item] : [];
    fetched += items.length;
    if (fetched > total) {
      throw new Error(`totalCount 초과 수집: ${fetched}/${total} (gubun=${gubun})`);
    }
    for (const it of items) {
      if ((it.CARTYPE ?? '').includes('이륜')) out.push(it);
    }
    process.stdout.write(`\rgubun=${gubun} ${fetched}/${total} (이륜 ${out.length})`);
    if (fetched === total) break;
    if (items.length < ROWS) {
      throw new Error(`페이지가 중간에 잘렸습니다: ${fetched}/${total} (gubun=${gubun}, page=${page})`);
    }
  }
  console.log();
  return out;
}

mkdirSync('data/raw', { recursive: true });

// 인증일 오름차순으로 정렬해 저장: 커밋 diff 에 신규 인증만 드러나도록
// 코드포인트 비교(cmp)로 정렬 — localeCompare 는 실행 환경(ICU)에 따라 순서가
// 달라져 주간 sync 에서 내용 없는 diff 를 만든다. 키에 인증번호까지 넣어 동률 제거.
const sortKey = (r) =>
  `${r.EMIS_CERTI_DATE ?? r.NOISE_CERTI_DATE ?? ''}|${r.VEH_NM}|${r.VEH_TYPE}|${r.EMIS_CERTI_NO ?? r.NOISE_CERTI_NO ?? ''}`;
const cmp = (a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0);

// API 가 같은 행을 그대로 중복 반환한다(2026-07 실측: 수입 5,204건 중 689건).
// 완전 동일 행은 정보가 없으므로 걸러 저장한다 — 인증 건수도 이만큼 정직해진다.
function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = JSON.stringify(r, Object.keys(r).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const previousCount = (file) => {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value.length : null;
  } catch {
    return null;
  }
};

const assertNoUnexpectedShrink = (label, file, rows) => {
  const previous = previousCount(file);
  if (previous !== null && rows.length < previous && process.env.ALLOW_KENCIS_SHRINK !== '1') {
    throw new Error(
      `${label} 인증이 ${previous}건에서 ${rows.length}건으로 감소했습니다. ` +
      'API 이상이 아닌 의도된 감소라면 ALLOW_KENCIS_SHRINK=1 로 다시 실행하세요.',
    );
  }
};

const writeAtomically = (file, rows) => {
  const temp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, JSON.stringify(rows, null, 1));
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

// 두 API를 모두 끝까지 받은 뒤 기존 파일과 비교한다. 한쪽 수집만 성공한 상태로
// 원본을 덮어쓰거나, 일시적인 부분 응답이 대량 삭제 PR로 이어지는 것을 막는다.
const imported = dedupe(await fetchAll(1)).sort(cmp);
const domestic = dedupe(await fetchAll(2)).sort(cmp);

assertNoUnexpectedShrink('수입제작', 'data/raw/kencis-import.json', imported);
assertNoUnexpectedShrink('국내제작', 'data/raw/kencis-domestic.json', domestic);

writeAtomically('data/raw/kencis-import.json', imported);
writeAtomically('data/raw/kencis-domestic.json', domestic);

console.log(`수입제작 이륜 ${imported.length}건 → data/raw/kencis-import.json`);
console.log(`국내제작 이륜 ${domestic.length}건 → data/raw/kencis-domestic.json`);
