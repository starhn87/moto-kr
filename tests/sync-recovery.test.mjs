import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasValidatedSync,
  isPriorSyncCandidate,
  kstDate,
} from '../scripts/sync-recovery.mjs';

const run = (overrides = {}) => ({
  id: 100,
  conclusion: 'success',
  event: 'schedule',
  created_at: '2026-09-07T04:17:00Z',
  ...overrides,
});

const prepare = (buildConclusion) => [{
  name: 'prepare',
  steps: [
    { name: 'fetch KENCIS with short retries', conclusion: 'success' },
    { name: 'build and validate raw sync', conclusion: buildConclusion },
  ],
}];

const published = (conclusion = 'success') => ({
  name: 'publish', conclusion,
  steps: [{ name: 'create or update sync PR', conclusion }],
});

test('KST 날짜를 기준으로 같은 날의 이전 성공 실행을 고른다', () => {
  assert.equal(kstDate('2026-09-06T15:30:00Z'), '2026-09-07');
  assert.equal(isPriorSyncCandidate(run(), 200, '2026-09-07'), true);
  assert.equal(isPriorSyncCandidate(run(), 100, '2026-09-07'), false);
  assert.equal(isPriorSyncCandidate(run({ created_at: '2026-09-06T14:59:59Z' }), 200, '2026-09-07'), false);
});

test('수동 실행의 성공도 뒤따르는 예약 슬롯을 막는다', () => {
  assert.equal(isPriorSyncCandidate(run({ event: 'workflow_dispatch' }), 200, '2026-09-07'), true);
});

test('수집·빌드뿐 아니라 PR 게시까지 성공해야 완료로 인정한다', () => {
  assert.equal(hasValidatedSync([...prepare('success'), published()]), true);
  assert.equal(hasValidatedSync(prepare('success')), false);
  assert.equal(hasValidatedSync([...prepare('success'), published('failure')]), false);
  assert.equal(hasValidatedSync([...prepare('skipped'), published()]), false);
  assert.equal(hasValidatedSync([...prepare('failure'), published()]), false);
  assert.equal(hasValidatedSync([]), false);
});

test('코멘트만 실패한 실행은 중복 수집을 막지만 취소·진행 중 실행은 제외한다', () => {
  assert.equal(isPriorSyncCandidate(run({ conclusion: 'failure' }), 200, '2026-09-07'), true);
  assert.equal(hasValidatedSync([...prepare('success'), published(), { name: 'comment', conclusion: 'failure' }]), true);
  assert.equal(isPriorSyncCandidate(run({ conclusion: 'cancelled' }), 200, '2026-09-07'), false);
  assert.equal(isPriorSyncCandidate(run({ conclusion: null }), 200, '2026-09-07'), false);
});

test('경고 종료된 API 장애 실행은 다음 슬롯을 막지 않는다', () => {
  const softFailure = run({ conclusion: 'success' });
  assert.equal(isPriorSyncCandidate(softFailure, 200, '2026-09-07'), true);
  assert.equal(hasValidatedSync(prepare('skipped')), false);
});
