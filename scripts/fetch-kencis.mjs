// KENCIS(환경부 자동차 배출가스·소음 인증) 오픈API에서 이륜차 인증 전량을 수집한다.
// 국내 판매용 이륜차는 인증이 법정 의무이므로 이 목록이 정발 기종의 공식 전수에 가장 가깝다.
//
// 사용: DATA_GO_KR_KEY=<공공데이터포털 인증키> node scripts/fetch-kencis.mjs
// 산출: data/raw/kencis-import.json (수입제작차), data/raw/kencis-domestic.json (국내제작차)
//
// API: https://www.data.go.kr/data/15000988/openapi.do (무료, 개발계정 월 1만 건)
// 주의: 차종(이륜) 필터 파라미터가 없어 전량 페이징 후 CARTYPE 로 걸러낸다.

import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) {
  console.error('DATA_GO_KR_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const BASE = 'https://apis.data.go.kr/1480523/Kencis/getVems';
const ROWS = 1000;

async function fetchAll(gubun) {
  const out = [];
  let total = null;
  for (let page = 1; ; page++) {
    const url = `${BASE}?serviceKey=${KEY}&pageNo=${page}&numOfRows=${ROWS}&resultType=json&gubun=${gubun}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} (page ${page})`);
    const body = await res.json();
    const v = body.getVems;
    if (v?.header?.code && v.header.code !== '00') {
      throw new Error(`API error: ${v.header.code} ${v.header.message}`);
    }
    total ??= v.totalCount;
    const items = v.item ?? [];
    for (const it of items) {
      if ((it.CARTYPE ?? '').includes('이륜')) out.push(it);
    }
    process.stdout.write(`\rgubun=${gubun} ${Math.min(page * ROWS, total)}/${total} (이륜 ${out.length})`);
    if (page * ROWS >= total || items.length < ROWS) break;
  }
  console.log();
  return out;
}

mkdirSync('data/raw', { recursive: true });

// 인증일 오름차순으로 정렬해 저장 — 커밋 diff 가 신규 인증만 드러나도록
const sortKey = (r) => `${r.EMIS_CERTI_DATE ?? r.NOISE_CERTI_DATE ?? ''}|${r.VEH_NM}|${r.VEH_TYPE}`;

const imported = (await fetchAll(1)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
writeFileSync('data/raw/kencis-import.json', JSON.stringify(imported, null, 1));
console.log(`수입제작 이륜 ${imported.length}건 → data/raw/kencis-import.json`);

const domestic = (await fetchAll(2)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
writeFileSync('data/raw/kencis-domestic.json', JSON.stringify(domestic, null, 1));
console.log(`국내제작 이륜 ${domestic.length}건 → data/raw/kencis-domestic.json`);
