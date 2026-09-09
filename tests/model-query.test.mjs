import assert from 'node:assert/strict';
import test from 'node:test';

import { MODEL_QUERY_PARAMS, filterModels, normalizeQueryDate, parseModelQuery } from '../api/src/model-query.mjs';

const parse = (value) => parseModelQuery(new URLSearchParams(value));

test('사용법에 공개된 파라미터가 실제 파서의 허용 목록이다', () => {
  for (const key of Object.keys(MODEL_QUERY_PARAMS)) {
    assert.doesNotMatch(parse(`${key}=invalid`).error ?? '', /지원하지 않는 파라미터/);
  }
  assert.match(parse('typo=true').error, /지원하지 않는 파라미터/);
});

test('복합 모델 쿼리를 정규화한다', () => {
  const { query } = parse('brand=혼다, 야마하&category=스쿠터&from=2024-02&to=2024-02&cylinders=1,2&limit=5');
  assert.deepEqual(query.brands, ['혼다', '야마하']);
  assert.deepEqual(query.categories, ['스쿠터']);
  assert.equal(query.from, '2024-02-01');
  assert.equal(query.to, '2024-02-29');
  assert.deepEqual(query.cylinders, [1, 2]);
  assert.equal(query.limit, 5);
});

test('윤년과 잘못된 일자를 구분한다', () => {
  assert.equal(normalizeQueryDate('2024-02', true), '2024-02-29');
  assert.equal(normalizeQueryDate('2023-02-29', true), undefined);
});

test('숫자 범위에서 값이 없는 모델을 제외하고 페이징한다', () => {
  const models = [
    { nameKo: '가 A', aliases: [], brand: '가', displacement: null },
    { nameKo: '가 B', aliases: ['B125'], brand: '가', displacement: 125 },
    { nameKo: '가 C', aliases: [], brand: '가', displacement: 300 },
  ];
  const { query } = parse('ccMin=100&ccMax=200&q=B125&offset=0&limit=1');
  assert.deepEqual(filterModels(models, query), { total: 1, models: [models[1]] });
});
