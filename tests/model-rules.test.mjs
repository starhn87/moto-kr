import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CATEGORIES,
  COOLING_TYPES,
  CYLINDER_COUNTS,
  FUEL_GRADES,
  isCanonicalModelName,
  normalizeVehicleName,
} from '../lib/model-rules.mjs';

test('차명 정규화가 구두점과 로마 숫자를 일관되게 처리한다', () => {
  assert.equal(normalizeVehicleName('TOYOUDAY Ⅱ'), 'TOYOUDAY2');
  assert.equal(normalizeVehicleName('BMW R 1250 GS'), 'BMWR1250GS');
});

test('일반 모델과 단일어 모델의 표준 이름을 판정한다', () => {
  assert.equal(isCanonicalModelName({ nameKo: '혼다 PCX125', brand: '혼다', model: 'PCX125' }), true);
  assert.equal(isCanonicalModelName({ nameKo: '플레타', brand: '플레타', model: '플레타' }), true);
  assert.equal(isCanonicalModelName({ nameKo: 'PCX125', brand: '혼다', model: 'PCX125' }), false);
});

test('AI 출력 스키마 enum이 공통 모델 규칙과 일치한다', async () => {
  const schemaUrl = new URL('../.github/codex/schemas/enrichment.schema.json', import.meta.url);
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
  const model = schema.properties.operations.items.properties.model.anyOf[1].properties;

  assert.deepEqual(model.category.enum, [...CATEGORIES, null]);
  assert.deepEqual(model.fuelGrade.enum, [...FUEL_GRADES, null]);
  assert.deepEqual(model.cooling.enum, [...COOLING_TYPES, null]);
  assert.deepEqual(model.cylinders.enum, [...CYLINDER_COUNTS, null]);
});
