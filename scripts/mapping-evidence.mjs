// 근거와 후보를 같은 HEAD·입력에 묶는다. 모델 판단 없이 확인할 수 있는 계약이다.
import { createHash } from 'node:crypto';
import { enrichmentSubjects, evidenceUsable } from './collect-sync-evidence.mjs';

export const hashJson = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const candidateKey = (item) => `${item.bucket}\0${item.office ?? ''}\0${item.vehNm}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sourceUrl = (value) => {
  const url = new URL(value);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, '허용되지 않은 출처 URL');
  return url.href;
};

export function bindProposalEvidence(candidateDocument, proposal, evidence, { headSha, raw }) {
  assert(/^[a-f0-9]{40}$/.test(headSha ?? ''), '근거 HEAD SHA 오류');
  const expected = enrichmentSubjects(candidateDocument.candidates, raw);
  assert(evidence && evidenceUsable(evidence, { phase: 'enrich', headSha }) && evidence.status === 'complete', '같은 HEAD의 완료된 근거가 필요합니다');
  assert(evidence.inputHash === hashJson(expected), '근거 후보·원본 입력이 일치하지 않습니다');
  assert(Array.isArray(evidence.items) && evidence.items.length === expected.length && Array.isArray(evidence.sources), '근거 항목 누락');
  const retrieved = new Set(evidence.sources.map(source => sourceUrl(source.url)));
  const items = new Map();
  const expectedIds = new Set(expected.map(subject => subject.id));
  for (const item of evidence.items) {
    assert(expectedIds.delete(item.id), '근거 ID 중복 또는 잘못된 대상');
    assert(['supported', 'conflicting', 'insufficient'].includes(item.conclusion) && typeof item.evidence === 'string' && item.evidence.trim(), '근거 판정 오류');
    assert(Array.isArray(item.sourceUrls), '근거 출처 배열 누락');
    if (item.conclusion !== 'insufficient') assert(item.sourceUrls.length > 0, '근거 출처 누락');
    for (const url of item.sourceUrls) assert(retrieved.has(sourceUrl(url)), '실제 수집되지 않은 근거 출처');
    items.set(item.id, item);
  }
  const bound = new Map(expected.map(subject => [candidateKey(subject.candidate), { subject, evidence: items.get(subject.id) }]));
  for (const operation of proposal.operations) {
    const item = bound.get(candidateKey(operation))?.evidence;
    assert(item, '제안의 근거 대상이 없습니다');
    const allowed = new Set(item.sourceUrls.map(sourceUrl));
    for (const source of operation.sources) assert(allowed.has(sourceUrl(source.url)), '제안 출처가 해당 후보의 실제 수집 근거에 없습니다');
    if (operation.action !== 'unresolved' && operation.confidence === 'high') {
      assert(item.conclusion === 'supported', '근거가 불충분하거나 충돌한 후보는 자동 매핑할 수 없습니다');
    }
  }
  return bound;
}
