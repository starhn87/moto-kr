import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyProposal } from '../scripts/apply-ai-mappings.mjs';
import { enrichmentSubjects } from '../scripts/collect-sync-evidence.mjs';
import { bindProposalEvidence, hashJson } from '../scripts/mapping-evidence.mjs';
import { auditMappings } from '../scripts/audit-jev-mappings.mjs';

const headSha = 'a'.repeat(40);
const candidate = { bucket: 'unmapped', office: '공식 수입사', vehNm: 'BIKE125' };
const candidates = { candidates: [candidate], reviewItems: [candidate] };
const raw = [{ VEH_NM: candidate.vehNm, OFFICE_NM: candidate.office, VEH_TYPE: 'ABC125-K' }];
const models = [{ nameKo: '브랜드 바이크125', aliases: [] }];
const url = 'https://manufacturer.example/codes';
const proposal = { summary: '고신뢰 제안', operations: [{ ...candidate, action: 'alias', targetNameKo: models[0].nameKo,
  model: null, confidence: 'high', reason: '형식코드 확인', sources: [{ url, title: '형식코드' }] }] };
const subjects = enrichmentSubjects(candidates.candidates, raw);
const evidence = { version: 1, phase: 'enrich', headSha, status: 'complete', subjects, inputHash: hashJson(subjects),
  items: [{ id: subjects[0].id, conclusion: 'supported', evidence: '공식 표에서 코드 연결 확인', sourceUrls: [url] }], sources: [{ url, title: '형식코드' }] };
const input = { candidates, proposal, evidence, models, raw, headSha, runId: '123' };
const reply = choice => Response.json({ model: 'jev-1.13.0', answers: { link: { type: 'choice', choice, confidence: 1,
  probabilities: Object.fromEntries(['direct', 'base_only', 'contradictory', 'insufficient'].map(label => [label, label === choice ? 1 : 0])) } } });

test('동일 HEAD·후보·인증 원본·수집 출처에 묶인 제안만 실제 반영할 수 있다', () => {
  const result = applyProposal(models, candidates, proposal, { evidence, raw, headSha });
  assert.deepEqual(result.models[0].aliases, ['BIKE125']);
  assert.deepEqual(models[0].aliases, []);
  const invalid = [
    { evidence: { ...evidence, headSha: 'b'.repeat(40) } },
    { raw: [{ ...raw[0], VEH_TYPE: 'OTHER' }] },
    { evidence: { ...evidence, items: [{ ...evidence.items[0], conclusion: 'insufficient' }] } },
    { evidence: { ...evidence, sources: [] } },
    { evidence: { ...evidence, items: [{ ...evidence.items[0], id: 'wrong' }] } },
  ];
  for (const override of invalid) assert.throws(() => applyProposal(models, candidates, proposal, { evidence, raw, headSha, ...override }));
  const invented = structuredClone(proposal); invented.operations[0].sources[0].url = 'https://invented.example';
  assert.throws(() => bindProposalEvidence(candidates, invented, evidence, { headSha, raw }), /실제 수집 근거/);
});

test('다른 후보에서 수집한 출처를 재사용하거나 근거 ID를 중복시키면 거부한다', () => {
  const c = { ...candidate, vehNm: 'OTHER125' };
  const two = { ...candidates, candidates: [candidate, c], reviewItems: [candidate, c] };
  const both = enrichmentSubjects(two.candidates, raw);
  const ev = { ...evidence, subjects: both, inputHash: hashJson(both), items: [evidence.items[0], { ...evidence.items[0], id: both[1].id, sourceUrls: ['https://other.example'] }], sources: [...evidence.sources, { url: 'https://other.example' }] };
  const prop = { ...proposal, operations: [...proposal.operations, { ...proposal.operations[0], ...c }] };
  assert.throws(() => bindProposalEvidence(two, prop, ev, { headSha, raw }), /실제 수집 근거/);
  assert.throws(() => bindProposalEvidence(two, prop, { ...ev, items: [ev.items[0], ev.items[0]] }, { headSha, raw }), /ID 중복/);
});

test('shadow는 분포·제안 hash·run·질문 버전을 기록하며 매핑/제안 원본을 변경하지 않는다', async () => {
  const before = JSON.stringify(input);
  const report = await auditMappings(input, { mode: 'shadow', apiKey: 'canary-secret', fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.model, 'jev-1.13.0');
    assert.equal(request.state.subject.certifications[0].VEH_TYPE, 'ABC125-K');
    return reply('base_only');
  } });
  assert.equal(report.status, 'complete');
  assert.equal(report.proposalHash, hashJson(proposal));
  assert.equal(report.runId, '123');
  assert.equal(report.rows[0].result.answers.link.choice, 'base_only');
  assert.equal(report.rows[0].result.meta.definitionVersion, '1');
  assert.ok(report.rows[0].result.meta.durationMs >= 0);
  assert.equal(JSON.stringify(input), before);
  assert.doesNotMatch(JSON.stringify(report), /canary-secret|공식 표/);
});

test('형식이 잘못된 응답은 위치·이유만 기록하고 기존 제안은 유지한다', async () => {
  const before = JSON.stringify(input);
  let calls = 0;
  const report = await auditMappings(input, { mode: 'shadow', apiKey: 'mock', fetch: async () => {
    calls++;
    return Response.json({ answers: { link: { type: 'choice', choice: 'private-label', confidence: 1,
      probabilities: { direct: 1, base_only: 0, contradictory: 0, insufficient: 0 } } } });
  } });
  assert.equal(calls, 1);
  assert.equal(report.status, 'partial');
  assert.deepEqual(report.rows[0].result.error, { kind: 'invalid_response', issues: [{ path: ['link', 'choice'], code: 'invalid_choice' }] });
  assert.equal(JSON.stringify(input), before);
  assert.doesNotMatch(JSON.stringify(report), /private-label/);
});

test('비활성·키 없음·잘못된 근거는 과금하지 않고 공급자 실패도 기존 매핑에 영향 없다', async () => {
  const noFetch = () => assert.fail('Unexpected request');
  assert.equal((await auditMappings(input, { apiKey: 'mock', fetch: noFetch })).reason, 'disabled');
  assert.equal((await auditMappings(input, { mode: 'enforce', apiKey: 'mock', fetch: noFetch })).reason, 'disabled');
  assert.equal((await auditMappings(input, { mode: 'shadow', fetch: noFetch })).reason, 'missing-key');
  assert.equal((await auditMappings({ ...input, headSha: 'b'.repeat(40) }, { mode: 'shadow', apiKey: 'mock', fetch: noFetch })).status, 'invalid_input');
  const report = await auditMappings(input, { mode: 'shadow', apiKey: 'mock', fetch: async () => { throw new Error('canary-secret'); } });
  assert.equal(report.status, 'partial');
  assert.equal(report.rows[0].result.ok, false);
  assert.doesNotMatch(JSON.stringify(report), /canary-secret/);
});

test('Jev 잡은 읽기 전용이며 publish·Codex 마지막 단계·독립 리뷰 경계를 유지한다', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sync.yml', import.meta.url), 'utf8');
  const enrich = workflow.split('\n  enrich:')[1].split('\n  jev-audit:')[0];
  const audit = workflow.split('\n  jev-audit:')[1].split('\n  publish:')[0];
  const publish = workflow.split('\n  publish:')[1].split('\n  review-target:')[0];
  assert.doesNotMatch(enrich.slice(enrich.indexOf('uses: openai/codex-action')), /\n      - /);
  assert.doesNotMatch(audit, /contents: write|pull-requests: write|OPENAI_API_KEY/);
  assert.match(audit, /JEV_MAPPING_MODE: \$\{\{ vars.JEV_MAPPING_MODE \|\| 'off' \}\}/);
  assert.match(publish, /needs: \[prepare, enrich\]/);
  assert.doesNotMatch(publish, /TYPESAFE_API_KEY|audit-jev|jev-audit/);
  assert.match(publish, /enrichment-evidence\/sync-evidence.json/);
  const review = workflow.split('\n  review:')[1].split('\n  comment:')[0];
  assert.ok(review.indexOf('run: npm ci') < review.indexOf('ref: ${{ needs.review-target'));
  assert.doesNotMatch(review.slice(review.indexOf('uses: openai/codex-action')), /\n      - /);
});
