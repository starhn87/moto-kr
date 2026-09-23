import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, evidenceRequest, evidenceUsable, enrichmentSubjects, LIMITS, parseEvidence, reviewSubjects } from '../scripts/collect-sync-evidence.mjs';

const cert = { office: '공식 수입사', vehNm: 'BIKE125', vehType: 'A1' };
const model = { nameKo: '브랜드 바이크125', displacement: 125, certifications: [cert] };
const subjects = reviewSubjects({ models: [] }, { models: [model] });
const options = { phase: 'review', subjects, headSha: 'a'.repeat(40), apiKey: 'secret-canary' };
const url = 'https://manufacturer.example/specs';
const reportItem = { id: subjects[0].id, conclusion: 'supported', evidence: '제조사 제원상 125cc', sourceUrls: [url] };
const responseBody = (items = [reportItem]) => ({
  status: 'completed', usage: { input_tokens: 40, output_tokens: 20 },
  output: [
    { type: 'web_search_call', status: 'completed', action: { sources: [{ url, title: 'Official specs' }] } },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ items }) }] },
  ],
});

test('변경 모델과 새 인증만 수집하며 메타 갱신·기존 잔여 미매핑은 제외한다', () => {
  const newCert = { ...cert, vehNm: 'BIKE125 SE' };
  const oldReview = { unmapped: [{ vehNm: 'OLD', office: 'A' }] };
  const next = { ...model, certifications: [cert, newCert] };
  const result = reviewSubjects({ models: [model] }, { meta: { generatedAt: 'new' }, models: [next] }, oldReview, oldReview);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].addedCertifications, [newCert]);
  assert.equal(result[0].before.displacement, 125);
  assert.equal(reviewSubjects({ models: [model] }, { models: [model] }).length, 0);
});

test('삭제 모델, 제원 수정, 새 모호 항목도 검증 범위에 포함한다', () => {
  const result = reviewSubjects({ models: [model, { ...model, nameKo: '삭제 모델' }] },
    { models: [{ ...model, displacement: 150 }] }, {}, { ambiguous: [{ vehNm: 'NEW' }] });
  assert.equal(result.length, 3);
  assert.equal(result[0].after.displacement, 150);
  assert.equal(result[1].after, null);
  assert.equal(result[2].kind, 'unresolved');
});

test('사전 수집은 업체+차명 모두 일치하는 인증만 후보와 묶는다', () => {
  const candidate = { vehNm: 'NEW', office: 'A' };
  const rows = [{ VEH_NM: 'NEW', OFFICE_NM: 'A', VEH_TYPE: 'X' }, { VEH_NM: 'NEW', OFFICE_NM: 'B' }];
  assert.deepEqual(enrichmentSubjects([candidate], rows)[0].certifications, [rows[0]]);
});

test('Sol hosted web_search만 제공하고 저장·토큰·호출 수를 제한한다', () => {
  const request = evidenceRequest(subjects, 'gpt-6-sol');
  assert.equal(request.model, 'gpt-6-sol');
  assert.equal(request.store, false);
  assert.deepEqual(request.tools, [{ type: 'web_search' }]);
  assert.equal(request.max_tool_calls, LIMITS.toolCalls);
  assert.equal(request.max_output_tokens, LIMITS.outputTokens);
  assert.deepEqual(request.include, ['web_search_call.action.sources']);
  assert.match(request.instructions, /The legacy kencis\.me\.go\.kr host is no longer a working citation target: do not cite its URLs/);
  assert.match(request.instructions, /search its unsuffixed base code in official manufacturer or regulator records/);
  assert.match(request.instructions, /distinguish a verified base-platform identity from an unverified market suffix/);
});

test('실제 검색 출처와 전체 대상의 id가 확인돼야 완료로 저장한다', async () => {
  let calls = 0;
  const result = await collectEvidence({ ...options, fetchImpl: async (endpoint, request) => {
    calls++;
    assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    assert.equal(JSON.parse(request.body).model, 'gpt-6-sol');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer secret-canary');
    assert.equal(request.signal.aborted, false);
    return { ok: true, json: async () => responseBody() };
  } });
  assert.equal(calls, 1);
  assert.equal(result.model, 'gpt-6-sol');
  assert.equal(result.status, 'complete');
  assert.equal(result.webSearchCalls, 1);
  assert.equal(result.usage.inputTokens, 40);
  assert.ok(evidenceUsable(result, options));
  assert.equal(evidenceUsable(result, { ...options, headSha: 'b'.repeat(40) }), false);
  assert.equal(evidenceUsable(result, { ...options, phase: 'enrich' }), false);
  assert.equal(evidenceUsable({ ...result, subjects: [] }, options), false);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
});

test('환각 출처·누락·중복·검색 생략·불완전 응답을 거부한다', () => {
  assert.throws(() => parseEvidence(responseBody([{ ...reportItem, sourceUrls: ['https://invented.example'] }]), subjects));
  assert.throws(() => parseEvidence(responseBody([]), subjects));
  assert.throws(() => parseEvidence(responseBody([reportItem, reportItem]), [...subjects, { id: 'different' }]));
  assert.throws(() => parseEvidence({ ...responseBody(), output: responseBody().output.slice(1) }, subjects));
  assert.throws(() => parseEvidence({ ...responseBody(), status: 'incomplete' }, subjects));
  assert.throws(() => parseEvidence(responseBody([{ ...reportItem, sourceUrls: [] }]), subjects));
});

test('검색했지만 근거가 없는 항목은 insufficient 그대로 보존한다', () => {
  const result = parseEvidence(responseBody([{ ...reportItem, conclusion: 'insufficient', sourceUrls: [] }]), subjects);
  assert.equal(result.items[0].conclusion, 'insufficient');
});

test('대상 없음·입력 상한 초과·키 없음이면 과금 요청을 하지 않는다', async () => {
  const fetchImpl = async () => { assert.fail('Unexpected paid request'); };
  assert.equal((await collectEvidence({ ...options, subjects: [], fetchImpl })).status, 'not_needed');
  assert.equal((await collectEvidence({ ...options, subjects: Array(21).fill(subjects[0]), fetchImpl })).error, 'input-budget-exceeded');
  assert.equal((await collectEvidence({ ...options, subjects: [{ id: 'x', text: 'x'.repeat(60_001) }], fetchImpl })).error, 'input-budget-exceeded');
  assert.equal((await collectEvidence({ ...options, apiKey: '', fetchImpl })).error, 'missing-api-key');
});

test('HTTP·타임아웃·파싱 실패는 재시도나 키·API 본문 노출 없이 수동 검토로 돌린다', async () => {
  const cases = [
    async () => ({ ok: false, status: 403, json: async () => { throw new Error('secret-canary'); } }),
    async () => { throw new Error('secret-canary'); },
    async () => ({ ok: true, json: async () => { throw new Error('secret-canary'); } }),
    async () => ({ ok: true, json: async () => ({ error: { message: 'secret-canary' } }) }),
  ];
  for (const fetchImpl of cases) {
    let calls = 0;
    const result = await collectEvidence({ ...options, fetchImpl: (...args) => { calls++; return fetchImpl(...args); } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'failed');
    assert.equal(evidenceUsable(result, options), false);
    assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
  }
});
