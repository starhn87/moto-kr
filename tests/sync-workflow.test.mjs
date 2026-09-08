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
