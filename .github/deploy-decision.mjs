// push는 before/after, pull_request는 base/head 트리 diff로 배포 여부를 정한다.
// deploy=false면 워크플로의 deploy 잡 자체가 실행되지 않는다.
// 워커가 실제로 읽는 경로는 배포한다: api 소스, lib, 빌드 입력(mapping, scripts, data).
// .github, docs, tests와 루트 문서는 배포하지 않는다. 확장자로 통째로 면제하지 않는다.
// diff를 구하지 못하면 배포 판정을 true로 쓰지 않고 실패한다.

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT_DOCS = new Set(['README.md', 'CONTRIBUTING.md', 'LICENSE', '.gitignore']);
const ZERO_SHA = /^0{40}$/;
const SHA = /^[0-9a-f]{40}$/i;

export const isNonDeployingPath = (path) => {
  const normalized = normalizeChangedPath(path);
  return normalized.startsWith('.github/')
    || normalized.startsWith('docs/')
    || normalized.startsWith('tests/')
    || ROOT_DOCS.has(normalized);
};

export const normalizeChangedPath = (path) => {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw new Error('변경 경로가 비어 있거나 판정할 수 없습니다. 배포하지 않습니다.');
  }
  if (path.startsWith('/') || path.includes('\\')) {
    throw new Error(`저장소 상대 경로가 아닙니다: ${path}. 배포하지 않습니다.`);
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`저장소 상대 경로가 아닙니다: ${path}. 배포하지 않습니다.`);
  }
  return path;
};

export const decideDeploy = (paths) => {
  const deployPaths = [];
  const skipPaths = [];
  for (const path of paths) {
    if (isNonDeployingPath(path)) skipPaths.push(path);
    else deployPaths.push(path);
  }
  return { deploy: deployPaths.length > 0, deployPaths, skipPaths };
};

export const parseNameStatus = (output) => {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output ?? '');
  if (text.length === 0) return [];
  const records = text.split('\0');
  if (records.at(-1) === '') records.pop();
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index];
    const renamed = /^[RC]\d+$/.test(status);
    if (!renamed && !/^[ADMTU]$/.test(status)) {
      throw new Error(`판정할 수 없는 diff 상태입니다: ${status}. 배포하지 않습니다.`);
    }
    const path = records[index + 1];
    if (path === undefined) throw new Error('diff 기록이 잘렸습니다. 배포하지 않습니다.');
    paths.push(path);
    index += 1;
    if (!renamed) continue;
    const destination = records[index + 1];
    if (destination === undefined) throw new Error('이름 변경 diff가 잘렸습니다. 배포하지 않습니다.');
    paths.push(destination);
    index += 1;
  }
  return paths;
};

export const assertPushRange = (before, after) => {
  if (!SHA.test(before ?? '') || !SHA.test(after ?? '')) {
    throw new Error('push before/after SHA가 없습니다. 배포하지 않습니다.');
  }
  if (ZERO_SHA.test(before) || ZERO_SHA.test(after)) {
    throw new Error('push 범위의 이전 커밋을 알 수 없습니다. 배포하지 않습니다.');
  }
};

const gitResult = (args, cwd) => spawnSync('git', args, {
  cwd,
  timeout: 20000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});

export const changedPathsBetween = (before, after, git = gitResult, cwd) => {
  assertPushRange(before, after);
  for (const sha of [before, after]) {
    const resolved = git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], cwd);
    if (resolved.error || resolved.status !== 0) {
      throw new Error(`커밋 ${sha}을 확인하지 못했습니다. 배포하지 않습니다.`);
    }
  }
  const diff = git(['diff', '--no-renames', '--name-status', '-z', before, after], cwd);
  if (diff.error || diff.status !== 0) {
    const detail = diff.stderr?.toString('utf8').trim();
    throw new Error(`push 범위 diff에 실패했습니다. 배포하지 않습니다.${detail ? ` ${detail}` : ''}`);
  }
  return parseNameStatus(diff.stdout).map(normalizeChangedPath);
};

export const selectRange = (env) => {
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    return { before: env.PR_BASE_SHA, after: env.PR_HEAD_SHA };
  }
  if (env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== 'push') {
    throw new Error(`지원하지 않는 이벤트 ${env.GITHUB_EVENT_NAME}입니다. 배포하지 않습니다.`);
  }
  return { before: env.DEPLOY_BEFORE, after: env.DEPLOY_AFTER };
};

const writeDecision = (decision) => {
  const line = `deploy=${decision.deploy ? 'true' : 'false'}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  console.log(line.trim());
  const changed = [...decision.deployPaths, ...decision.skipPaths];
  if (changed.length === 0) console.log('changed paths: (none)');
  for (const path of changed) console.log(path);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '### Wrangler 배포 판정',
      '',
      `- 배포: ${decision.deploy ? '예' : '아니오'}`,
      '',
    ];
    if (decision.deployPaths.length > 0) {
      lines.push('배포 경로:', ...decision.deployPaths.map((path) => `- \`${path}\``), '');
    }
    if (decision.skipPaths.length > 0) {
      lines.push('배포 제외 경로:', ...decision.skipPaths.map((path) => `- \`${path}\``), '');
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
};

const main = () => {
  try {
    const range = selectRange(process.env);
    const decision = decideDeploy(changedPathsBetween(range.before, range.after));
    writeDecision(decision);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
