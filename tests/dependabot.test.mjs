import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const configPath = new URL('../.github/dependabot.yml', import.meta.url);

const entry = (config, ecosystem) => {
  const found = config
    .split(/\n {2}- package-ecosystem: /)
    .find((block) => block.startsWith(`"${ecosystem}"`));
  assert.ok(found, `${ecosystem} entry`);
  return found;
};

const updateTypes = (block) => {
  const match = block.match(/update-types:\n((?:\s+- "[^"]+"\n)+)/);
  assert.ok(match, 'update-types');
  return [...match[1].matchAll(/- "([^"]+)"/g)].map((item) => item[1]);
};

test('Dependabot는 실제 생태계만 매주 서울 시간에 버전 업데이트한다', async () => {
  const config = await readFile(configPath, 'utf8');
  const ecosystems = [...config.matchAll(/^ {2}- package-ecosystem: "([^"]+)"/gm)].map((item) => item[1]);
  assert.deepEqual(ecosystems, ['npm', 'github-actions']);

  for (const ecosystem of ecosystems) {
    const block = entry(config, ecosystem);
    assert.match(block, /directory: "\/"/);
    assert.match(block, /interval: "weekly"/);
    assert.match(block, /day: "monday"/);
    assert.match(block, /time: "09:00"/);
    assert.match(block, /timezone: "Asia\/Seoul"/);
    assert.match(block, /applies-to: "version-updates"/);
    assert.match(block, /patterns:\n\s+- "\*"/);
    assert.deepEqual(updateTypes(block), ['minor', 'patch']);
    assert.equal(block.match(/^\s*directory: "([^"]+)"/m)[1], '/');
  }

  assert.equal(entry(config, 'npm').match(/open-pull-requests-limit: (\d+)/)[1], '2');
  assert.equal(entry(config, 'github-actions').match(/open-pull-requests-limit: (\d+)/)[1], '1');
  const limits = [...config.matchAll(/open-pull-requests-limit: (\d+)/g)].map((item) => Number(item[1]));
  assert.equal(limits.reduce((sum, limit) => sum + limit, 0), 3);
  assert.doesNotMatch(config, /auto-merge|automerg/i);
});
