import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEW_COMMENT_MARKER,
  checkEarlierSuccessfulSync,
  composeSyncPrBody,
  renderReviewComment,
  upsertReviewComment,
} from '../scripts/sync-workflow.mjs';

test('실제 변경 요약과 AI 보완 결과를 PR 본문으로 조합한다', () => {
  const body = composeSyncPrBody({ summary: '## 실제 변경\n', enrichment: '### AI 보완\n', aiStatus: 'applied' });
  assert.match(body, /^주간 자동 수집/);
  assert.match(body, /## 실제 변경/);
  assert.match(body, /### AI 보완/);
  assert.match(body, /자동 보완 상태: `applied`/);
  assert.match(body, /읽기 전용 AI 검증/);
});

test('AI 검증 결과를 머지 가능 코멘트로 만든다', () => {
  const body = renderReviewComment({
    reviewJobResult: 'success',
    reviewJson: JSON.stringify({ verdict: 'ready', summary: '문제없음', findings: [], checks: ['npm run check'] }),
  });
  assert.match(body, new RegExp(REVIEW_COMMENT_MARKER));
  assert.match(body, /이대로 머지 가능/);
  assert.match(body, /조치가 필요한 발견 사항 없음/);
  assert.match(body, /npm run check/);
});

test('AI 검증 실패나 잘못된 결과는 수동 확인 안내로 바꾼다', () => {
  assert.match(renderReviewComment({ reviewJobResult: 'failure', reviewJson: '' }), /수동 확인 후 머지/);
  assert.match(renderReviewComment({ reviewJobResult: 'success', reviewJson: '{}' }), /verdict is invalid/);
});

test('오늘 이미 검증된 동기화가 있으면 예약 복구 슬롯을 건너뛴다', async () => {
  const outputs = [];
  const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} };
  const core = { setOutput: (...args) => outputs.push(args), notice: () => {}, warning: () => {}, summary };
  const github = {
    rest: {
      actions: { getWorkflowRun: {}, listWorkflowRuns: {}, listJobsForWorkflowRun: {} },
    },
    paginate: async (endpoint) => {
      if (endpoint === github.rest.actions.listWorkflowRuns) {
        return [{ id: 1, conclusion: 'success', event: 'schedule', created_at: '2026-09-07T04:17:00Z', html_url: 'https://example.test/run', run_number: 1 }];
      }
      return [{ name: 'prepare', steps: [{ name: 'build and validate raw sync', conclusion: 'success' }] }];
    },
  };
  github.rest.actions.getWorkflowRun = async () => ({ data: { created_at: '2026-09-07T07:17:00Z' } });
  const context = { eventName: 'schedule', runId: 2, repo: { owner: 'owner', repo: 'repo' } };

  assert.equal(await checkEarlierSuccessfulSync({ github, context, core }), false);
  assert.deepEqual(outputs.at(-1), ['should-run', 'false']);
});

test('기존 AI 코멘트가 있으면 새 코멘트를 만들지 않고 갱신한다', async () => {
  const calls = [];
  const github = {
    rest: { issues: { listComments: {}, updateComment: async (args) => calls.push(['update', args]), createComment: async (args) => calls.push(['create', args]) } },
    paginate: async () => [{ id: 10, user: { login: 'github-actions[bot]' }, body: REVIEW_COMMENT_MARKER }],
  };
  await upsertReviewComment({
    github,
    context: { repo: { owner: 'owner', repo: 'repo' } },
    pullRequestNumber: 7,
    reviewJobResult: 'success',
    reviewJson: JSON.stringify({ verdict: 'action_required', summary: '보완 필요', findings: [], checks: [] }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[0][1].comment_id, 10);
  assert.match(calls[0][1].body, /추가 조치 필요/);
});
