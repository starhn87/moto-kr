import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../.github/workflows/sync.yml', import.meta.url);

test('Codex 동기화 단계는 codex exec 호환 설정으로 실시간 웹 검색을 켠다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const expectedArgs = 'codex-args: \'["-c", "web_search=\\"live\\"", "--ephemeral"]\'';

  assert.equal(workflow.split(expectedArgs).length - 1, 2);
  assert.doesNotMatch(workflow, /codex-args:.*"--search"/);
});

test('AI 모델을 고정하고 continue-on-error 전의 실제 결과를 전달한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.equal(workflow.split("model: ${{ vars.CODEX_SYNC_MODEL || 'gpt-6-astra' }}").length - 1, 2);
  assert.match(workflow, /outcome: \$\{\{ steps\.codex\.outcome \}\}/);
  assert.match(workflow, /REVIEW_JOB_RESULT: \$\{\{ needs\.review\.outputs\.outcome \|\| needs\.review\.result \}\}/);
});

test('코멘트 잡은 쓰기 토큰으로 PR 코드를 실행하지 않고 신뢰된 스크립트를 체크아웃한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const comment = workflow.split('\n  comment:')[1];
  assert.match(comment, /contents: read/);
  assert.match(comment, /actions\/checkout@v7[\s\S]*ref: \$\{\{ github\.sha \}\}[\s\S]*persist-credentials: false/);
  assert.ok(comment.indexOf('actions/checkout') < comment.indexOf('actions/github-script'));
  assert.doesNotMatch(comment, /ref:.*head-sha/);
  assert.match(comment, /reviewedHeadSha: process\.env\.REVIEWED_HEAD_SHA/);
});

test('재검증 전용 실행은 prepare를 건너뛰고 최신 sync PR HEAD를 사용한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /review-only:[\s\S]*type: boolean/);
  assert.match(workflow, /prepare:\n\s+if: \$\{\{ !inputs\.review-only \}\}/);
  assert.match(workflow, /review-target:[\s\S]*if: always\(\) && \(inputs\.review-only/);
  assert.match(workflow, /review:\n\s+needs: review-target\n\s+if: always\(\) && needs\.review-target\.result == 'success'/);
  assert.match(workflow, /ref: \$\{\{ needs\.review-target\.outputs\.head-sha \}\}/);
});
