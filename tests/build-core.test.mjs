import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDataset, boundedIncludes, emissionStandardOf, nonVehicleReason, wordStartsOf } from '../scripts/build-core.mjs';

const model = (nameKo, aliases = []) => {
  const [brand, ...modelParts] = nameKo.split(' ');
  return { nameKo, brand, model: modelParts.join(' '), aliases, electric: false };
};

const row = (vehNm, vehType = '', overrides = {}) => ({
  VEH_NM: vehNm,
  VEH_TYPE: vehType,
  OFFICE_NM: '테스트 제작사',
  EMIS_CERTI_NO: `CERT-${vehNm}-${vehType}`,
  EMIS_CERTI_DATE: '2025/01/02',
  FUELTYPE: '휘발유',
  ...overrides,
});

const build = ({ imported = [], domestic = [], seed = [], previousModels, previousReview, today = '2026-09-09' }) =>
  buildDataset({ imported, domestic, offices: {}, seed, previousModels, previousReview, today });

test('형식 지정 별칭이 같은 인증 차명을 올바른 모델로 나눈다', () => {
  const result = build({
    imported: [row('공통차명', 'TYPE-A'), row('공통차명', 'TYPE-B')],
    seed: [model('테스트 모델A', ['공통차명@TYPE-A']), model('테스트 모델B', ['공통차명@TYPE-B'])],
  });

  assert.deepEqual(result.full.models.map((item) => item.certifications.length), [1, 1]);
  assert.equal(result.review.ambiguous.length, 0);
});

test('같은 점수의 후보는 임의 매핑하지 않고 ambiguous로 보낸다', () => {
  const result = build({
    imported: [row('MATCH125')],
    seed: [model('가상브랜드 MATCH125'), model('다른브랜드 MATCH125')],
  });

  assert.equal(result.review.ambiguous.length, 1);
  assert.deepEqual(result.review.ambiguous[0].candidates, ['가상브랜드 MATCH125', '다른브랜드 MATCH125']);
  assert.equal(result.full.meta.counts.unmapped, 0);
});

test('숫자로 끝나는 모델 토큰은 더 긴 숫자의 일부로 매칭되지 않는다', () => {
  const normalized = 'BMWR1250GS';
  assert.equal(boundedIncludes(normalized, 'R12', wordStartsOf('BMW R1250GS')), false);
  const result = build({ imported: [row('BMW R1250GS')], seed: [model('BMW R12')] });
  assert.equal(result.full.models[0].certifications.length, 0);
  assert.equal(result.review.unmapped.length, 1);
});

test('자리표시자와 시험 등록분은 unmapped가 아니라 excluded로 분리한다', () => {
  const result = build({ imported: [row('동일차_1'), row('test0830'), row('실제차')] });
  assert.equal(result.review.unmapped.length, 1);
  assert.deepEqual(result.review.excluded.map((item) => item.reason).sort(), ['KENCIS 자리표시자', '시험 등록분'].sort());
  assert.equal(nonVehicleReason('테스트0610'), '시험 등록분');
});

test('배출 기준 문구를 우선하고 없으면 인증일로 추정한다', () => {
  assert.equal(emissionStandardOf('2020년 1월 기준', '2018-01-01'), 'euro5');
  assert.equal(emissionStandardOf(null, '2019-01-01'), 'euro4');
  assert.equal(emissionStandardOf(null, '2009-01-01'), 'euro3');
  assert.equal(emissionStandardOf(null, '2005-01-01'), null);
});

test('입력과 산출 내용이 같으면 기존 generatedAt을 유지한다', () => {
  const first = build({ imported: [row('테스트125')], seed: [model('테스트 테스트125')], today: '2026-09-08' });
  const second = build({
    imported: [row('테스트125')],
    seed: [model('테스트 테스트125')],
    previousModels: first.full,
    previousReview: first.review,
    today: '2026-09-09',
  });
  assert.equal(second.full.meta.generatedAt, '2026-09-08');
});
