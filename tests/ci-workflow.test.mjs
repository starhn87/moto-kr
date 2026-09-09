import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url);

test('CI는 PR 브랜치 push를 중복 실행하지 않고 main push만 직접 검증한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /\n\s+pull_request:/);
  assert.doesNotMatch(workflow, /on:\s*\[push,\s*pull_request\]/);
});
