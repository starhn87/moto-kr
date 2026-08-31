// 동기화 전후의 원본 인증·모델·매핑·검토 목록 차이를 PR 본문용 Markdown으로 요약한다.
// 사용: node scripts/summarize-sync.mjs <before-root> <after-root> <output>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_ITEMS = 40;
const buckets = ['unmapped', 'ambiguous', 'excluded'];
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const md = (value) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 200);
const delta = (before, after) => {
  const value = after - before;
  return value > 0 ? `+${value}` : String(value);
};
const rawDate = (row) => (row.EMIS_CERTI_DATE ?? row.NOISE_CERTI_DATE ?? '').replaceAll('/', '-');
const rawNo = (row) => row.EMIS_CERTI_NO ?? row.NOISE_CERTI_NO ?? null;
const certKey = (gubun, no, office, vehNm, vehType) =>
  [gubun, no ?? '', office ?? '', vehNm ?? '', vehType ?? ''].join('\0');
const reviewKey = (item) => [item.bucket, item.office ?? '', item.vehNm].join('\0');

const reviewItems = (review) => buckets.flatMap((bucket) =>
  (review[bucket] ?? []).map((item) => ({ bucket, ...item })),
);

const multisetDiff = (before, after) => {
  const remaining = new Map();
  for (const item of before) {
    const key = stable(item);
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key).push(item);
  }
  const added = [];
  for (const item of after) {
    const key = stable(item);
    const matches = remaining.get(key);
    if (matches?.length) matches.pop();
    else added.push(item);
  }
  return { added, removed: [...remaining.values()].flat() };
};

const keyedDiff = (before, after, keyOf) => {
  const previous = new Map(before.map((item) => [keyOf(item), item]));
  const current = new Map(after.map((item) => [keyOf(item), item]));
  const added = [...current].filter(([key]) => !previous.has(key)).map(([, item]) => item);
  const removed = [...previous].filter(([key]) => !current.has(key)).map(([, item]) => item);
  const changed = [...current]
    .filter(([key, item]) => previous.has(key) && stable(previous.get(key)) !== stable(item))
    .map(([key, item]) => ({ before: previous.get(key), after: item }));
  return { added, removed, changed };
};

const loadSnapshot = (root) => ({
  imported: JSON.parse(readFileSync(join(root, 'data/raw/kencis-import.json'), 'utf8')),
  domestic: JSON.parse(readFileSync(join(root, 'data/raw/kencis-domestic.json'), 'utf8')),
  models: JSON.parse(readFileSync(join(root, 'data/models.json'), 'utf8')),
  review: JSON.parse(readFileSync(join(root, 'data/unmapped.json'), 'utf8')),
  mapping: JSON.parse(readFileSync(join(root, 'mapping/models.json'), 'utf8')),
});

const rowsOf = (snapshot) => [
  ...snapshot.imported.map((row) => ({ ...row, _gubun: 'import' })),
  ...snapshot.domestic.map((row) => ({ ...row, _gubun: 'domestic' })),
];

const resolutionIndex = (snapshot) => {
  const index = new Map();
  for (const model of snapshot.models.models) {
    for (const cert of model.certifications) {
      index.set(certKey(cert.gubun, cert.no, cert.office, cert.vehNm, cert.vehType), model.nameKo);
    }
  }
  return index;
};

const resolutionOf = (snapshot, index, row) => {
  const model = index.get(certKey(row._gubun, rawNo(row), row.OFFICE_NM, row.VEH_NM, row.VEH_TYPE));
  if (model) return `매핑: ${model}`;
  const item = reviewItems(snapshot.review).find((entry) =>
    entry.vehNm === row.VEH_NM && (entry.office ?? '') === (row.OFFICE_NM ?? ''),
  );
  if (!item) return '미분류';
  return item.bucket === 'unmapped' ? '미매핑' : item.bucket === 'ambiguous' ? '모호' : `제외: ${item.reason ?? '비실차'}`;
};

const renderLimited = (items, render) => {
  const lines = items.slice(0, MAX_ITEMS).map(render);
  if (items.length > MAX_ITEMS) lines.push(`- 그 외 ${items.length - MAX_ITEMS}건`);
  return lines;
};

const mappingChangeDetail = ({ before, after }) => {
  const details = [];
  const beforeAliases = new Set(before.aliases ?? []);
  const afterAliases = new Set(after.aliases ?? []);
  const aliasesAdded = [...afterAliases].filter((alias) => !beforeAliases.has(alias));
  const aliasesRemoved = [...beforeAliases].filter((alias) => !afterAliases.has(alias));
  if (aliasesAdded.length) details.push(`별칭 추가: ${aliasesAdded.join(', ')}`);
  if (aliasesRemoved.length) details.push(`별칭 제거: ${aliasesRemoved.join(', ')}`);
  for (const key of Object.keys(after)) {
    if (key === 'aliases' || stable(before[key]) === stable(after[key])) continue;
    details.push(`${key}: ${before[key] ?? 'null'} → ${after[key] ?? 'null'}`);
  }
  return details.slice(0, 5).join('; ') || '내부 필드 변경';
};

export const summarizeSync = (before, after) => {
  const beforeRows = rowsOf(before);
  const afterRows = rowsOf(after);
  const rawDiff = multisetDiff(beforeRows, afterRows);
  const mappingDiff = keyedDiff(before.mapping, after.mapping, (model) => model.nameKo);
  const reviewDiff = keyedDiff(reviewItems(before.review), reviewItems(after.review), reviewKey);
  const beforeCounts = before.models.meta.counts;
  const afterCounts = after.models.meta.counts;
  const afterIndex = resolutionIndex(after);
  const beforeIndex = resolutionIndex(before);

  rawDiff.added.sort((a, b) => rawDate(b).localeCompare(rawDate(a)));
  rawDiff.removed.sort((a, b) => rawDate(b).localeCompare(rawDate(a)));

  const lines = [
    '## 실제 변경 요약',
    '',
    '| 항목 | 이전 | 이후 | 증감 |',
    '| --- | ---: | ---: | ---: |',
    `| 수입 인증 | ${before.imported.length} | ${after.imported.length} | ${delta(before.imported.length, after.imported.length)} |`,
    `| 국내 인증 | ${before.domestic.length} | ${after.domestic.length} | ${delta(before.domestic.length, after.domestic.length)} |`,
    `| 공개 모델 | ${beforeCounts.models} | ${afterCounts.models} | ${delta(beforeCounts.models, afterCounts.models)} |`,
    `| 매핑된 모델 | ${beforeCounts.verified} | ${afterCounts.verified} | ${delta(beforeCounts.verified, afterCounts.verified)} |`,
    `| 미매핑 | ${beforeCounts.unmapped} | ${afterCounts.unmapped} | ${delta(beforeCounts.unmapped, afterCounts.unmapped)} |`,
    `| 모호 | ${beforeCounts.ambiguous} | ${afterCounts.ambiguous} | ${delta(beforeCounts.ambiguous, afterCounts.ambiguous)} |`,
    `| 제외 | ${beforeCounts.excluded} | ${afterCounts.excluded} | ${delta(beforeCounts.excluded, afterCounts.excluded)} |`,
    '',
    '### 인증 원본 변화',
    '',
    `- 추가 ${rawDiff.added.length}건 / 제거 ${rawDiff.removed.length}건`,
  ];

  if (rawDiff.added.length || rawDiff.removed.length) {
    lines.push('', '| 구분 | 인증일 | 인증번호 | 인증 차명 | 형식 | 업체 | 반영 결과 |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const row of rawDiff.added.slice(0, MAX_ITEMS)) {
      lines.push(`| 추가·${row._gubun === 'import' ? '수입' : '국내'} | ${md(rawDate(row))} | ${md(rawNo(row))} | ${md(row.VEH_NM)} | ${md(row.VEH_TYPE)} | ${md(row.OFFICE_NM)} | ${md(resolutionOf(after, afterIndex, row))} |`);
    }
    for (const row of rawDiff.removed.slice(0, Math.max(0, MAX_ITEMS - rawDiff.added.length))) {
      lines.push(`| 제거·${row._gubun === 'import' ? '수입' : '국내'} | ${md(rawDate(row))} | ${md(rawNo(row))} | ${md(row.VEH_NM)} | ${md(row.VEH_TYPE)} | ${md(row.OFFICE_NM)} | ${md(resolutionOf(before, beforeIndex, row))} |`);
    }
    if (rawDiff.added.length + rawDiff.removed.length > MAX_ITEMS) {
      lines.push(`| … | — | — | 그 외 ${rawDiff.added.length + rawDiff.removed.length - MAX_ITEMS}건 | — | — | — |`);
    }
  } else {
    lines.push('- 인증 원본 행 변화 없음');
  }

  lines.push('', '### 소비자 모델 매핑 변화', '');
  const mappingChanges = [
    ...mappingDiff.added.map((model) => `- 추가: **${md(model.nameKo)}** — 인증 별칭 ${md((model.aliases ?? []).join(', ') || '없음')}`),
    ...mappingDiff.removed.map((model) => `- 제거: **${md(model.nameKo)}**`),
    ...mappingDiff.changed.map((change) => `- 변경: **${md(change.after.nameKo)}** — ${md(mappingChangeDetail(change))}`),
  ];
  lines.push(...(mappingChanges.length ? renderLimited(mappingChanges, (line) => line) : ['- 매핑 시드 변화 없음']));

  lines.push('', '### 검토 목록 변화', '');
  const reviewChanges = [
    ...reviewDiff.added.map((item) => `- 추가: \`${item.bucket}\` **${md(item.vehNm)}** — ${md(item.office)} (${item.count ?? 0}건)`),
    ...reviewDiff.removed.map((item) => `- 해소: \`${item.bucket}\` **${md(item.vehNm)}** — ${md(item.office)}`),
    ...reviewDiff.changed.map(({ before: old, after: item }) => `- 변경: \`${item.bucket}\` **${md(item.vehNm)}** — ${old.count ?? 0} → ${item.count ?? 0}건`),
  ];
  lines.push(...(reviewChanges.length ? renderLimited(reviewChanges, (line) => line) : ['- 미매핑·모호·제외 목록 변화 없음']));

  return `${lines.join('\n')}\n`;
};

const main = () => {
  const [, , beforeRoot, afterRoot, outputPath] = process.argv;
  if (!beforeRoot || !afterRoot || !outputPath) {
    throw new Error('사용법: node scripts/summarize-sync.mjs <before-root> <after-root> <output>');
  }
  writeFileSync(outputPath, summarizeSync(loadSnapshot(beforeRoot), loadSnapshot(afterRoot)));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
