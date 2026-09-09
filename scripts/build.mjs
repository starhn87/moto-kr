// raw(KENCIS 인증)와 mapping(사람이 관리)을 합쳐 배포용 데이터셋을 만든다.
//
//   data/models.json       풀 스키마: 기종별 인증 이력 전문
//   data/models.lite.json  경량판: 인증 이력 대신 요약(건수·업체). 쿼리 API 가 임베드
//   data/models.min.json   최소판: 자동완성용 한글 표기 배열
//   data/unmapped.json     시드에 매핑되지 않은 인증 차명: 기여 대상 목록
//
// 사용: node scripts/build.mjs

import { readFileSync, writeFileSync } from 'node:fs';

import { buildDataset } from './build-core.mjs';

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
const loadOptional = (path) => {
  try {
    return load(path);
  } catch {
    return null;
  }
};

const output = buildDataset({
  imported: load('data/raw/kencis-import.json'),
  domestic: load('data/raw/kencis-domestic.json'),
  offices: load('mapping/offices.json'),
  seed: load('mapping/models.json'),
  previousModels: loadOptional('data/models.json'),
  previousReview: loadOptional('data/unmapped.json'),
});

writeFileSync('data/models.json', JSON.stringify(output.full, null, 1));
writeFileSync('data/models.lite.json', JSON.stringify(output.lite));
writeFileSync('data/models.min.json', JSON.stringify(output.min));
writeFileSync('data/unmapped.json', JSON.stringify(output.review, null, 1));

const { counts } = output.full.meta;
console.log(`models: ${counts.models} (verified ${counts.verified} / curated ${counts.curated})`);
console.log(`인증 원본 ${counts.certifications}건 중 미매핑 차명 ${counts.unmapped}개 → data/unmapped.json`);
console.log(`실차 아닌 차명 ${counts.excluded}개는 excluded 로 분리 (자리표시자·시험 등록분)`);
console.log(`매칭 동점으로 보류된 차명 ${counts.ambiguous}개 → data/unmapped.json (ambiguous) — 별칭 추가로 확정 필요`);
