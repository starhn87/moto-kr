import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeSync } from '../scripts/summarize-sync.mjs';

const raw = (name, no, office = '테스트모터스') => ({
  EMIS_CERTI_NO: no,
  EMIS_CERTI_DATE: '2026/08/31',
  NOISE_CERTI_NO: null,
  NOISE_CERTI_DATE: null,
  OFFICE_NM: office,
  VEH_NM: name,
  VEH_TYPE: `${name}-TYPE`,
});
const cert = (name, no) => ({
  no,
  date: '2026-08-31',
  office: '테스트모터스',
  vehNm: name,
  vehType: `${name}-TYPE`,
  fuel: '휘발유',
  gubun: 'import',
});
const mapping = (name, aliases) => ({
  nameKo: name,
  brand: name.split(' ')[0],
  model: name.split(' ').slice(1).join(' '),
  aliases,
  displacement: 125,
  category: '스쿠터',
  electric: false,
  fuelGrade: 'regular',
  seatHeight: null,
  weight: null,
  cylinders: 1,
  cooling: 'air',
  fuelCapacity: null,
  power: null,
});
const snapshot = ({ imported = [], modelList = [], mappingList = [], unmapped = [] } = {}) => ({
  imported,
  domestic: [],
  models: {
    meta: {
      counts: {
        models: modelList.length,
        verified: modelList.filter((model) => model.certifications.length).length,
        curated: modelList.filter((model) => !model.certifications.length).length,
        certifications: imported.length,
        unmapped: unmapped.length,
        ambiguous: 0,
        excluded: 0,
      },
    },
    models: modelList,
  },
  review: { unmapped, ambiguous: [], excluded: [] },
  mapping: mappingList,
});

test('신규 인증과 매핑 결과를 PR 본문용으로 보여준다', () => {
  const beforeMapping = mapping('테스트 알파125', ['ALPHA']);
  const afterMapping = mapping('테스트 알파125', ['ALPHA', 'ALPHA-NEW']);
  const before = snapshot({ mappingList: [beforeMapping] });
  const after = snapshot({
    imported: [raw('ALPHA-NEW', 'R-1')],
    mappingList: [afterMapping],
    modelList: [{ nameKo: '테스트 알파125', certifications: [cert('ALPHA-NEW', 'R-1')] }],
  });

  const markdown = summarizeSync(before, after);
  assert.match(markdown, /수입 인증 \| 0 \| 1 \| \+1/);
  assert.match(markdown, /R-1/);
  assert.match(markdown, /ALPHA-NEW/);
  assert.match(markdown, /매핑: 테스트 알파125/);
  assert.match(markdown, /별칭 추가: ALPHA-NEW/);
});

test('새 미매핑 인증을 실질 변경과 검토 목록에 표시한다', () => {
  const item = { vehNm: 'UNKNOWN125', office: '테스트모터스', count: 1, lastDate: '2026-08-31' };
  const before = snapshot();
  const after = snapshot({ imported: [raw('UNKNOWN125', 'R-2')], unmapped: [item] });

  const markdown = summarizeSync(before, after);
  assert.match(markdown, /UNKNOWN125/);
  assert.match(markdown, /미매핑/);
  assert.match(markdown, /`unmapped`/);
});
