import test from 'node:test';
import assert from 'node:assert/strict';

import { findNewReviewItems } from '../scripts/find-new-unmapped.mjs';
import { applyProposal } from '../scripts/apply-ai-mappings.mjs';

const baseModel = {
  nameKo: '혼다 PCX125', brand: '혼다', model: 'PCX125', aliases: ['PCX'],
  displacement: 125, category: '스쿠터', electric: false, fuelGrade: 'regular',
  seatHeight: 764, weight: 130, cylinders: 1, cooling: 'liquid', fuelCapacity: 8.1, power: 13,
};
const candidate = { bucket: 'unmapped', vehNm: 'PCX125K', office: '혼다코리아(주)' };
const document = { candidates: [candidate], reviewItems: [candidate] };
const operation = (overrides = {}) => ({
  bucket: candidate.bucket,
  vehNm: candidate.vehNm,
  office: candidate.office,
  action: 'alias',
  targetNameKo: baseModel.nameKo,
  model: null,
  confidence: 'high',
  reason: '공식 형식코드가 일치함',
  sources: [{ title: '공식 문서', url: 'https://example.com/official' }],
  ...overrides,
});
const proposal = (operations) => ({ summary: '조사 결과', operations });

test('새로 생기거나 인증 정보가 달라진 검토 항목만 후보로 뽑는다', () => {
  const before = {
    unmapped: [{ vehNm: 'OLD', office: 'A' }, { vehNm: 'UPDATED', office: 'A', count: 1 }],
    ambiguous: [],
  };
  const after = {
    meta: { generatedAt: '2026-08-31' },
    unmapped: [
      { vehNm: 'OLD', office: 'A' },
      { vehNm: 'UPDATED', office: 'A', count: 2 },
      { vehNm: 'NEW', office: 'B' },
    ],
    ambiguous: [{ vehNm: 'TIE', office: 'C', candidates: ['가', '나'] }],
  };
  const result = findNewReviewItems(before, after);
  assert.deepEqual(result.candidates.map((item) => [item.bucket, item.vehNm]), [
    ['unmapped', 'UPDATED'], ['unmapped', 'NEW'], ['ambiguous', 'TIE'],
  ]);
  assert.equal(result.reviewItems.length, 4);
});

test('고신뢰 alias만 기존 모델에 반영한다', () => {
  const result = applyProposal([baseModel], document, proposal([operation()]));
  assert.deepEqual(result.models[0].aliases, ['PCX', 'PCX125K']);
  assert.equal(result.applied.length, 1);
});

test('중간 신뢰 제안은 매핑하지 않는다', () => {
  const result = applyProposal([baseModel], document, proposal([operation({ confidence: 'medium' })]));
  assert.deepEqual(result.models[0].aliases, ['PCX']);
  assert.equal(result.skipped.length, 1);
});

test('이번 동기화 후보가 아닌 작업을 거부한다', () => {
  assert.throws(
    () => applyProposal([baseModel], document, proposal([operation({ vehNm: 'NOT-A-CANDIDATE' })])),
    /이번 동기화 후보가 아닙니다/,
  );
});

test('고신뢰 신규 모델을 추가한다', () => {
  const proposed = {
    nameKo: '야마하 신모델125', brand: '야마하', model: '신모델125', aliases: ['PCX125K'],
    displacement: 125, category: '스쿠터', electric: false, fuelGrade: 'regular',
    seatHeight: null, weight: null, cylinders: 1, cooling: 'air', fuelCapacity: null, power: null,
  };
  const result = applyProposal([], document, proposal([
    operation({ action: 'new', targetNameKo: null, model: proposed }),
  ]));
  assert.equal(result.models[0].nameKo, '야마하 신모델125');
});

test('같은 실행의 신규 모델을 뒤따르는 별칭이 참조할 수 있다', () => {
  const second = { bucket: 'unmapped', vehNm: 'NEW125-A', office: '야마하' };
  const first = { bucket: 'unmapped', vehNm: 'NEW125', office: '야마하' };
  const multiDocument = { candidates: [second, first], reviewItems: [second, first] };
  const proposed = {
    nameKo: '야마하 NEW125', brand: '야마하', model: 'NEW125', aliases: ['NEW125'],
    displacement: 125, category: '스쿠터', electric: false, fuelGrade: 'regular',
    seatHeight: null, weight: null, cylinders: 1, cooling: 'air', fuelCapacity: null, power: null,
  };
  const common = {
    confidence: 'high', reason: '공식 자료에서 같은 모델로 확인',
    sources: [{ title: '공식 문서', url: 'https://example.com/official' }],
  };
  const result = applyProposal([], multiDocument, proposal([
    { bucket: 'unmapped', vehNm: 'NEW125-A', office: '야마하', action: 'alias', targetNameKo: '야마하 NEW125', model: null, ...common },
    { bucket: 'unmapped', vehNm: 'NEW125', office: '야마하', action: 'new', targetNameKo: null, model: proposed, ...common },
  ]));
  assert.deepEqual(result.models[0].aliases, ['NEW125', 'NEW125-A']);
});

test('동일 차명이 검토 목록에 여러 번 남아 있으면 전역 alias 자동 적용을 거부한다', () => {
  const duplicateDocument = {
    candidates: [candidate],
    reviewItems: [candidate, { ...candidate, office: '다른 업체' }],
  };
  assert.throws(
    () => applyProposal([baseModel], duplicateDocument, proposal([operation()])),
    /같은 차명이 여러 번/,
  );
});

test('형식코드별 별칭이 있는 차명은 전역 alias 자동 적용을 거부한다', () => {
  const typed = { ...baseModel, aliases: ['PCX125K@TYPE-A'] };
  assert.throws(
    () => applyProposal([typed], document, proposal([operation()])),
    /형식코드별 별칭/,
  );
});
