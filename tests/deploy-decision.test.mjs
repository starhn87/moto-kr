import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  changedPathsBetween,
  decideDeploy,
  parseNameStatus,
} from '../.github/deploy-decision.mjs';

const scriptPath = fileURLToPath(new URL('../.github/deploy-decision.mjs', import.meta.url));
const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url);
const nul = (parts) => Buffer.from(`${parts.join('\0')}\0`);

const git = (cwd, args) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

const withRepo = async (fn) => {
  const cwd = await mkdtemp(join(tmpdir(), 'moto-deploy-'));
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 'deploy-test@example.com']);
    git(cwd, ['config', 'user.name', 'deploy-test']);
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
};

const commit = async (cwd, files, message) => {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      git(cwd, ['rm', '-f', '--', path]);
      continue;
    }
    const full = join(cwd, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    git(cwd, ['add', '--', path]);
  }
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
};

const pathsOf = (before, after, cwd) => changedPathsBetween(before, after, undefined, cwd);

test('설정·문서·테스트만 있으면 배포하지 않고 런타임·빌드 입력·데이터는 배포한다', () => {
  const configOnly = [
    '.github/dependabot.yml',
    '.github/workflows/ci.yml',
    '.github/deploy-decision.mjs',
    '.github/codex/schemas/enrichment.schema.json',
    'docs/jev-mapping-audit.md',
    'docs/logo.png',
    'tests/dependabot.test.mjs',
    'tests/deploy-decision.test.mjs',
    'README.md',
    'CONTRIBUTING.md',
    'LICENSE',
    '.gitignore',
  ];
  assert.equal(decideDeploy(configOnly).deploy, false);

  for (const path of [
    'api/src/index.mjs',
    'api/src/model-query.mjs',
    'api/wrangler.toml',
    'api/.wrangler/cache/wrangler-account.json',
    'lib/model-rules.mjs',
    'data/models.json',
    'data/models.lite.json',
    'data/models.min.json',
    'data/unmapped.json',
    'data/raw/kencis-import.json',
    'mapping/models.json',
    'mapping/offices.json',
    'scripts/build.mjs',
    'scripts/build-core.mjs',
    'scripts/fetch-kencis.mjs',
    'package.json',
    'package-lock.json',
    'vendor/jev-decisions/package.json',
    'new-runtime.mjs',
  ]) {
    assert.equal(decideDeploy([path]).deploy, true, path);
  }

  assert.equal(decideDeploy(['README.md', 'data/models.lite.json']).deploy, true);
  assert.equal(decideDeploy([]).deploy, false);
});

test('삭제와 이름 변경은 양쪽 경로를 보고 JSON·YAML을 확장자로 면제하지 않는다', () => {
  assert.deepEqual(parseNameStatus(nul(['D', 'api/src/index.mjs'])), ['api/src/index.mjs']);
  assert.equal(decideDeploy(parseNameStatus(nul(['D', 'README.md']))).deploy, false);
  assert.equal(decideDeploy(parseNameStatus(nul(['D', 'data/models.json']))).deploy, true);
  assert.equal(decideDeploy(parseNameStatus(nul(['R100', 'api/src/index.mjs', 'docs/moved.mjs']))).deploy, true);
  assert.equal(decideDeploy(parseNameStatus(nul(['R100', 'README.md', 'docs/readme.md']))).deploy, false);
  assert.equal(decideDeploy(parseNameStatus(nul(['M', 'data/models.min.json']))).deploy, true);
  assert.equal(decideDeploy(parseNameStatus(nul(['M', '.github/workflows/sync.yml']))).deploy, false);
  assert.throws(() => parseNameStatus(nul(['X', 'README.md'])), /배포하지 않습니다/);
  assert.throws(() => parseNameStatus(Buffer.from('M\0')), /배포하지 않습니다/);
  assert.throws(() => decideDeploy(['../data/models.json']), /배포하지 않습니다/);
});

test('push before/after의 최종 트리로 여러 커밋·squash·삭제를 판정한다', async () => {
  await withRepo(async (cwd) => {
    const base = await commit(cwd, { 'README.md': 'base\n', 'data/models.json': 'old\n' }, 'base');
    await commit(cwd, { 'docs/note.md': 'note\n' }, 'docs');
    const squashed = await commit(cwd, { '.github/dependabot.yml': 'version: 2\n' }, 'squash config');
    assert.deepEqual(pathsOf(base, squashed, cwd).toSorted(), ['.github/dependabot.yml', 'docs/note.md']);
    assert.equal(decideDeploy(pathsOf(base, squashed, cwd)).deploy, false);

    const withData = await commit(cwd, { 'data/models.lite.json': '{}\n' }, 'data');
    await commit(cwd, { 'tests/deploy-decision.test.mjs': 'test\n' }, 'tests after data');
    assert.equal(decideDeploy(pathsOf(squashed, await head(cwd), cwd)).deploy, true);

    const reverted = await commit(cwd, { 'data/models.lite.json': null }, 'revert data');
    assert.equal(decideDeploy(pathsOf(squashed, reverted, cwd)).deploy, false);

    const deletedRuntime = await commit(cwd, { 'data/models.json': null }, 'delete data');
    assert.equal(decideDeploy(pathsOf(reverted, deletedRuntime, cwd)).deploy, true);
    assert.equal(withData.length, 40);
  });
});

test('diff가 실패하면 배포로 판정하지 않는다', () => {
  const git = (args) => {
    if (args[0] === 'rev-parse') return { status: 0, stdout: Buffer.alloc(0) };
    return { status: 2, stderr: Buffer.from('fatal: bad diff') };
  };
  assert.throws(
    () => changedPathsBetween('a'.repeat(40), 'b'.repeat(40), git),
    /diff에 실패했습니다/,
  );
});

test('범위를 확인하지 못하면 배포 출력을 쓰지 않는다', async () => {
  const zeros = '0'.repeat(40);
  assert.throws(() => changedPathsBetween(zeros, 'a'.repeat(40)), /배포하지 않습니다/);

  await withRepo(async (cwd) => {
    const output = join(cwd, 'github-output.txt');
    const missing = 'a'.repeat(40);
    const present = await commit(cwd, { 'README.md': 'x\n' }, 'one');
    const failed = spawnSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        DEPLOY_BEFORE: missing,
        DEPLOY_AFTER: present,
        GITHUB_OUTPUT: output,
      },
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /배포하지 않습니다/);
    await assert.rejects(readFile(output, 'utf8'));

    const skipped = spawnSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        DEPLOY_BEFORE: zeros,
        DEPLOY_AFTER: present,
        GITHUB_OUTPUT: output,
      },
    });
    assert.notEqual(skipped.status, 0);
    assert.match(skipped.stderr, /이전 커밋을 알 수 없습니다/);
    await assert.rejects(readFile(output, 'utf8'));

    const configOnly = await commit(cwd, { '.github/dependabot.yml': 'version: 2\n' }, 'config');
    const success = spawnSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        DEPLOY_BEFORE: present,
        DEPLOY_AFTER: configOnly,
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(await readFile(output, 'utf8'), 'deploy=false\n');
  });
});

test('검증 잡은 항상 실행되고 배포 잡은 main push의 판정이 true일 때만 Wrangler를 실행한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const onBlock = workflow.slice(0, workflow.indexOf('jobs:'));
  const validate = workflow.slice(workflow.indexOf('\n  validate:'), workflow.indexOf('\n  deploy:'));
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.doesNotMatch(onBlock, /paths-ignore|^\s+paths:/m);
  assert.match(validate, /npm run check/);
  assert.doesNotMatch(validate, /deploy-decision|wrangler-action/);
  assert.match(deploy, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /fetch-depth: 0/);
  assert.match(deploy, /DEPLOY_BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.match(deploy, /DEPLOY_AFTER: \$\{\{ github\.event\.after \}\}/);
  assert.match(deploy, /node \.github\/deploy-decision\.mjs/);
  assert.match(deploy, /steps\.decision\.outputs\.deploy != 'true' && steps\.decision\.outputs\.deploy != 'false'/);
  assert.match(deploy, /if: steps\.decision\.outputs\.deploy == 'true'\n\s+uses: cloudflare\/wrangler-action@v4/);
});

const head = (cwd) => git(cwd, ['rev-parse', 'HEAD']);
