import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDataset } from '../scripts/build-core.mjs';

const seed = JSON.parse(readFileSync(new URL('../mapping/models.json', import.meta.url), 'utf8'));

const row = (vehNm, vehType, fuel = '휘발유(Gasoline)') => ({
  VEH_NM: vehNm,
  VEH_TYPE: vehType,
  OFFICE_NM: '테스트 제작사',
  EMIS_CERTI_NO: `CERT-${vehNm}-${vehType}`,
  EMIS_CERTI_DATE: '2026/11/09',
  FUELTYPE: fuel,
});

const unsourcedSpecKeys = [
  'displacement', 'fuelGrade', 'seatHeight', 'weight', 'cylinders', 'cooling', 'fuelCapacity', 'power',
];

test('베스파 180·이누리 EM06 KS는 기존 모델과 분리되고 다이스 버스는 차단된다', () => {
  const bySeedName = Object.fromEntries(seed.map((model) => [model.nameKo, model]));
  const primavera = bySeedName['베스파 프리마베라180'];
  const sprint = bySeedName['베스파 스프린트180'];
  const em06 = bySeedName['이누리 EM06 KS'];
  const dice = bySeedName['킴스트 다이스'];

  assert.equal(primavera.model, '프리마베라180');
  assert.deepEqual(primavera.aliases, ['VESPA PRIMAVERA 180', 'VESPA PRIMAVERA S 180']);
  assert.equal(primavera.electric, false);
  assert.equal(primavera.category, '스쿠터');
  for (const key of unsourcedSpecKeys) assert.equal(primavera[key], null, key);

  assert.equal(sprint.model, '스프린트180');
  assert.deepEqual(sprint.aliases, [
    'VESPA SPRINT 180',
    'VESPA SPRINT S 180',
    'VESPA SPRINT TECH 180',
    'SPRINT S 180',
    'SPRINT TECH 180',
  ]);
  assert.equal(sprint.electric, false);
  for (const key of unsourcedSpecKeys) assert.equal(sprint[key], null, key);
  assert.ok(!bySeedName['베스파 프리마베라150'].aliases?.some((alias) => alias.includes('180')));
  assert.ok(!bySeedName['베스파 스프린트150'].aliases?.some((alias) => alias.includes('180')));

  assert.deepEqual(em06.aliases, ['이엠공육케이에스']);
  assert.equal(em06.electric, true);
  assert.equal(em06.category, '스쿠터');
  for (const key of unsourcedSpecKeys) assert.equal(em06[key], null, key);
  assert.ok(!bySeedName['이누리 DJ1'].aliases.includes('이엠공육케이에스'));
  assert.ok(!bySeedName['이누리 OK1 KS'].aliases.includes('이엠공육케이에스'));

  assert.ok(dice.aliases.includes('!다이스 버스'));
  assert.ok(dice.aliases.includes('다이스'));

  const result = buildDataset({
    imported: [
      row('VESPA PRIMAVERA 180', 'MD1M'),
      row('VESPA PRIMAVERA S 180', 'MD1M'),
      row('VESPA PRIMAVERA 125', 'MD1L'),
      row('VESPA SPRINT 180', 'MD1M'),
      row('VESPA SPRINT S 180', 'MD1M'),
      row('VESPA SPRINT TECH 180', 'MD1M'),
      row('SPRINT S 180', 'MD1M'),
      row('SPRINT TECH 180', 'MD1M'),
    ],
    domestic: [
      row('이엠공육케이에스', 'EM', '전기(EV)'),
      row('디제이원', 'DJ1', '전기(EV)'),
      row('다이스', 'KSTD01', '전기(EV)'),
      row('다이스 버스', 'DB1', '전기(EV)'),
    ],
    offices: {},
    seed,
    today: '2026-11-24',
  });
  const certNames = (nameKo) => result.full.models
    .find((model) => model.nameKo === nameKo)
    .certifications.map((certification) => certification.vehNm)
    .sort();

  assert.deepEqual(certNames('베스파 프리마베라180'), ['VESPA PRIMAVERA 180', 'VESPA PRIMAVERA S 180']);
  assert.deepEqual(certNames('베스파 프리마베라125'), ['VESPA PRIMAVERA 125']);
  assert.deepEqual(certNames('베스파 프리마베라150'), []);
  assert.deepEqual(certNames('베스파 스프린트180'), [
    'SPRINT S 180',
    'SPRINT TECH 180',
    'VESPA SPRINT 180',
    'VESPA SPRINT S 180',
    'VESPA SPRINT TECH 180',
  ]);
  assert.deepEqual(certNames('베스파 스프린트150'), []);
  assert.deepEqual(certNames('이누리 EM06 KS'), ['이엠공육케이에스']);
  assert.deepEqual(certNames('이누리 DJ1'), ['디제이원']);
  assert.deepEqual(certNames('킴스트 다이스'), ['다이스']);
  assert.deepEqual(result.review.unmapped.map((item) => item.vehNm), ['다이스 버스']);
  assert.equal(result.review.ambiguous.length, 0);
});
