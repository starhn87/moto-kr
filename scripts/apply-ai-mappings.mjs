// Codex가 제안한 구조화 JSON을 검증한 뒤, 고신뢰 매핑만 결정론적으로 반영한다.
// AI에는 파일 쓰기 권한을 주지 않고 이 스크립트만 mapping/models.json을 변경한다.
// 사용: node scripts/apply-ai-mappings.mjs <candidates> <proposal> <report>

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CATEGORIES = new Set([
  '스포츠', '네이키드', '크루저', '투어러', '어드벤처', '스쿠터',
  '언더본', '오프로드', '클래식', '미니', '3륜', '4륜',
]);
const FUEL_GRADES = new Set(['regular', 'premium']);
const COOLING = new Set(['air', 'liquid', 'oil']);
const CYLINDERS = new Set([1, 2, 3, 4, 6]);
const REQUIRED_MODEL_KEYS = [
  'nameKo', 'brand', 'model', 'aliases', 'displacement', 'category', 'electric',
  'fuelGrade', 'seatHeight', 'weight', 'cylinders', 'cooling', 'fuelCapacity', 'power',
];
const OPERATION_KEYS = [
  'bucket', 'vehNm', 'office', 'action', 'targetNameKo', 'model', 'confidence', 'reason', 'sources',
];

const candidateKey = (item) => `${item.bucket}\0${item.office ?? ''}\0${item.vehNm}`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const positiveIntegerOrNull = (value) => value == null || (Number.isInteger(value) && value > 0);
const positiveNumberOrNull = (value) => value == null || (Number.isFinite(value) && value > 0);

export const validateProposedModel = (model, vehNm) => {
  assert(model && typeof model === 'object' && !Array.isArray(model), `${vehNm}: model 객체가 필요합니다`);
  for (const key of REQUIRED_MODEL_KEYS) assert(Object.hasOwn(model, key), `${vehNm}: model.${key} 누락`);
  assert(Object.keys(model).every((key) => REQUIRED_MODEL_KEYS.includes(key)), `${vehNm}: model에 허용되지 않은 필드가 있습니다`);
  assert(typeof model.nameKo === 'string' && model.nameKo.trim(), `${vehNm}: nameKo 오류`);
  assert(typeof model.brand === 'string' && model.brand.trim(), `${vehNm}: brand 오류`);
  assert(typeof model.model === 'string' && model.model.trim(), `${vehNm}: model명 오류`);
  const single = model.nameKo === model.brand && model.model === model.brand;
  assert(single || model.nameKo === `${model.brand} ${model.model}`, `${vehNm}: nameKo는 brand + model이어야 합니다`);
  assert(Array.isArray(model.aliases) && model.aliases.includes(vehNm), `${vehNm}: aliases에 인증 차명이 필요합니다`);
  assert(model.aliases.every((alias) => typeof alias === 'string' && alias.trim()), `${vehNm}: aliases 오류`);
  assert(positiveIntegerOrNull(model.displacement), `${vehNm}: displacement 오류`);
  assert(model.category == null || CATEGORIES.has(model.category), `${vehNm}: category 오류`);
  assert(typeof model.electric === 'boolean', `${vehNm}: electric 오류`);
  assert(model.fuelGrade == null || FUEL_GRADES.has(model.fuelGrade), `${vehNm}: fuelGrade 오류`);
  for (const key of ['seatHeight', 'weight', 'power']) {
    assert(positiveIntegerOrNull(model[key]), `${vehNm}: ${key} 오류`);
  }
  assert(model.cylinders == null || CYLINDERS.has(model.cylinders), `${vehNm}: cylinders 오류`);
  assert(model.cooling == null || COOLING.has(model.cooling), `${vehNm}: cooling 오류`);
  assert(positiveNumberOrNull(model.fuelCapacity), `${vehNm}: fuelCapacity 오류`);
  if (model.electric) {
    for (const key of ['displacement', 'fuelGrade', 'cylinders', 'cooling', 'fuelCapacity', 'power']) {
      assert(model[key] == null, `${vehNm}: 전기 모델의 ${key}는 null이어야 합니다`);
    }
  }
};

const validateSources = (operation) => {
  assert(Array.isArray(operation.sources), `${operation.vehNm}: sources 배열이 필요합니다`);
  for (const source of operation.sources) {
    assert(source && typeof source === 'object' && !Array.isArray(source), `${operation.vehNm}: source 객체 오류`);
    assert(Object.keys(source).length === 2 && Object.hasOwn(source, 'url') && Object.hasOwn(source, 'title'), `${operation.vehNm}: source 필드 오류`);
    assert(source && typeof source.url === 'string' && /^https?:\/\//.test(source.url), `${operation.vehNm}: source URL 오류`);
    assert(typeof source.title === 'string' && source.title.trim(), `${operation.vehNm}: source title 오류`);
  }
};

export const applyProposal = (modelsInput, candidateDocument, proposal) => {
  assert(Array.isArray(modelsInput), 'models는 배열이어야 합니다');
  assert(Array.isArray(candidateDocument.candidates), 'candidates 배열이 필요합니다');
  assert(Array.isArray(candidateDocument.reviewItems), 'reviewItems 배열이 필요합니다');
  assert(proposal && Array.isArray(proposal.operations), 'proposal.operations 배열이 필요합니다');
  assert(typeof proposal.summary === 'string', 'proposal.summary 문자열이 필요합니다');
  assert(Object.keys(proposal).length === 2 && Object.hasOwn(proposal, 'summary'), 'proposal 필드 오류');

  const candidates = new Map(candidateDocument.candidates.map((item) => [candidateKey(item), item]));
  assert(candidates.size === candidateDocument.candidates.length, 'candidate 키가 중복되었습니다');
  const operations = new Map();
  for (const operation of proposal.operations) {
    assert(operation && typeof operation === 'object', 'operation 객체가 필요합니다');
    assert(OPERATION_KEYS.every((key) => Object.hasOwn(operation, key)), `${operation.vehNm}: operation 필드 누락`);
    assert(Object.keys(operation).every((key) => OPERATION_KEYS.includes(key)), `${operation.vehNm}: operation에 허용되지 않은 필드가 있습니다`);
    const key = candidateKey(operation);
    assert(candidates.has(key), `${operation.vehNm}: 이번 동기화 후보가 아닙니다`);
    assert(!operations.has(key), `${operation.vehNm}: operation이 중복되었습니다`);
    assert(['alias', 'new', 'unresolved'].includes(operation.action), `${operation.vehNm}: action 오류`);
    assert(['high', 'medium', 'low'].includes(operation.confidence), `${operation.vehNm}: confidence 오류`);
    assert(typeof operation.reason === 'string' && operation.reason.trim(), `${operation.vehNm}: reason이 필요합니다`);
    validateSources(operation);
    if (operation.action === 'alias') {
      assert(operation.model == null, `${operation.vehNm}: alias 작업의 model은 null이어야 합니다`);
      assert(typeof operation.targetNameKo === 'string' && operation.targetNameKo.trim(), `${operation.vehNm}: targetNameKo가 필요합니다`);
    } else if (operation.action === 'new') {
      assert(operation.targetNameKo == null, `${operation.vehNm}: new 작업의 targetNameKo는 null이어야 합니다`);
      validateProposedModel(operation.model, operation.vehNm);
      assert(operation.model.aliases.length === 1, `${operation.vehNm}: 신규 모델 aliases에는 해당 인증 차명 하나만 허용됩니다`);
    } else {
      assert(operation.targetNameKo == null && operation.model == null, `${operation.vehNm}: unresolved 작업의 대상 필드는 null이어야 합니다`);
    }
    if (operation.confidence === 'high' && operation.action !== 'unresolved') {
      assert(operation.sources.length > 0, `${operation.vehNm}: 고신뢰 자동 반영에는 출처가 필요합니다`);
    }
    operations.set(key, operation);
  }
  for (const key of candidates.keys()) assert(operations.has(key), `${candidates.get(key).vehNm}: operation 누락`);

  const reviewOccurrences = new Map();
  for (const item of candidateDocument.reviewItems) {
    reviewOccurrences.set(item.vehNm, (reviewOccurrences.get(item.vehNm) ?? 0) + 1);
  }

  const models = structuredClone(modelsInput);
  const applied = [];
  const skipped = [];
  const aliasOwners = new Map();
  const typedAliasBases = new Set();
  for (const model of models) {
    for (const alias of model.aliases ?? []) {
      aliasOwners.set(alias, model.nameKo);
      const at = alias.indexOf('@');
      if (at !== -1) typedAliasBases.add(alias.slice(0, at));
    }
  }

  const orderedOperations = candidateDocument.candidates
    .map((candidate) => operations.get(candidateKey(candidate)))
    .sort((a, b) => (a.action === 'new' ? -1 : 0) - (b.action === 'new' ? -1 : 0));

  for (const operation of orderedOperations) {
    if (operation.action === 'unresolved' || operation.confidence !== 'high') {
      skipped.push({ ...operation, skipReason: operation.action === 'unresolved' ? '미해결' : '고신뢰 아님' });
      continue;
    }
    assert(reviewOccurrences.get(operation.vehNm) === 1, `${operation.vehNm}: 검토 목록에 같은 차명이 여러 번 나타나 자동 매핑할 수 없습니다`);
    assert(!typedAliasBases.has(operation.vehNm), `${operation.vehNm}: 형식코드별 별칭이 이미 있어 전역 alias를 자동 추가할 수 없습니다`);

    if (operation.action === 'alias') {
      const targets = models.filter((model) => model.nameKo === operation.targetNameKo);
      assert(targets.length === 1, `${operation.vehNm}: targetNameKo가 유일하지 않습니다`);
      const owner = aliasOwners.get(operation.vehNm);
      assert(!owner || owner === targets[0].nameKo, `${operation.vehNm}: alias가 이미 ${owner}에 속합니다`);
      targets[0].aliases ??= [];
      if (!targets[0].aliases.includes(operation.vehNm)) targets[0].aliases.push(operation.vehNm);
      aliasOwners.set(operation.vehNm, targets[0].nameKo);
      applied.push(operation);
      continue;
    }

    assert(!models.some((model) => model.nameKo === operation.model.nameKo), `${operation.vehNm}: nameKo 중복`);
    for (const alias of operation.model.aliases) {
      assert(!aliasOwners.has(alias), `${operation.vehNm}: alias ${alias}가 이미 ${aliasOwners.get(alias)}에 속합니다`);
    }
    const model = structuredClone(operation.model);
    model.aliases = [...new Set(model.aliases)].sort();
    models.push(model);
    for (const alias of model.aliases) aliasOwners.set(alias, model.nameKo);
    applied.push(operation);
  }

  return { models, applied, skipped };
};

export const renderReport = (proposal, result) => {
  const lines = [
    '### AI 사전 보완',
    '',
    proposal.summary || '요약 없음',
    '',
    `- 자동 반영: ${result.applied.length}건`,
    `- 미반영/미해결: ${result.skipped.length}건`,
  ];
  for (const operation of [...result.applied, ...result.skipped]) {
    const applied = result.applied.includes(operation);
    lines.push('', `- ${applied ? '✅' : '⏸️'} **${operation.vehNm}** (${operation.action}, ${operation.confidence}) — ${operation.reason}`);
    for (const source of operation.sources) lines.push(`  - [${source.title}](${source.url})`);
  }
  return `${lines.join('\n')}\n`;
};

const main = () => {
  const [, , candidatesPath, proposalPath, reportPath] = process.argv;
  if (!candidatesPath || !proposalPath || !reportPath) {
    throw new Error('사용법: node scripts/apply-ai-mappings.mjs <candidates> <proposal> <report>');
  }
  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  const models = JSON.parse(readFileSync('mapping/models.json', 'utf8'));
  const result = applyProposal(models, candidates, proposal);
  writeFileSync('mapping/models.json', `${JSON.stringify(result.models, null, 1)}\n`);
  writeFileSync(reportPath, renderReport(proposal, result));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
