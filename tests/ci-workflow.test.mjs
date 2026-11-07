import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url);

test('CI는 PR 브랜치 push를 중복 실행하지 않고 main push만 직접 검증한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /\n\s+pull_request:/);
  assert.doesNotMatch(workflow, /on:\s*\[push,\s*pull_request\]/);
  assert.equal(workflow.split('actions/checkout@v7').length - 1, 3);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.doesNotMatch(workflow, /actions\/(checkout|setup-node)@v4/);
  assert.match(workflow, /cloudflare\/wrangler-action@v4/);
  assert.doesNotMatch(workflow, /cloudflare\/wrangler-action@v3/);
});

const cancelInProgress = (ref) => ref !== 'refs/heads/main';

test('main push는 진행 중 CI를 취소하지 않고 그 외 ref는 취소한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const concurrency = workflow.slice(workflow.indexOf('concurrency:'), workflow.indexOf('jobs:'));
  assert.match(concurrency, /group: ci-\$\{\{ github\.ref \}\}/);
  assert.match(concurrency, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  assert.equal(cancelInProgress('refs/heads/main'), false);
  assert.equal(cancelInProgress('refs/pull/41/merge'), true);
});
