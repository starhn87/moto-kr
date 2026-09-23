import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../.github/workflows/sync.yml', import.meta.url);

test('읽기 전용 Codex는 별도 수집된 근거를 쓰며 직접 네트워크 검색을 하지 않는다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const expectedArgs = 'codex-args: \'["-c", "web_search=\\"disabled\\"", "--ephemeral"]\'';

  assert.equal(workflow.split(expectedArgs).length - 1, 2);
  assert.doesNotMatch(workflow, /codex-args:.*"--search"/);
  assert.equal(workflow.split('sandbox: read-only').length - 1, 2);
  assert.match(workflow, /if: steps\.evidence\.outputs\.usable == 'true'/);
});

test('AI 모델을 고정하고 continue-on-error 전의 실제 결과를 전달한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.equal(workflow.split("model: ${{ vars.CODEX_SYNC_MODEL || 'gpt-6-sol' }}").length - 1, 2);
  assert.equal(workflow.split("EVIDENCE_MODEL: ${{ vars.CODEX_SYNC_MODEL || 'gpt-6-sol' }}").length - 1, 2);
  assert.doesNotMatch(workflow, /gpt-6-astra/);
  assert.match(workflow, /outcome: \$\{\{ steps\.codex\.outcome \}\}/);
  assert.match(workflow, /REVIEW_JOB_RESULT: \$\{\{ needs\.review\.outputs\.outcome \|\| needs\.review\.result \}\}/);
});

test('AI 보완 상태는 스크립트가 출력한 실제 반영 결과를 사용한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /if status=\$\(node scripts\/apply-ai-mappings\.mjs/);
  assert.doesNotMatch(workflow, /status=applied/);
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
  assert.match(workflow, /review:\n\s+needs: \[review-target, review-evidence\]\n\s+if: always\(\) && needs\.review-target\.result == 'success' && needs\.review-evidence\.outputs\.usable == 'true'/);
  assert.match(workflow, /ref: \$\{\{ needs\.review-target\.outputs\.head-sha \}\}/);
});

test('웹 수집기는 PR 코드를 실행하지 않고 키를 해당 단계에만 주입한다', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const evidence = workflow.split('\n  review-evidence:')[1].split('\n  review:')[0];
  assert.match(evidence, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(evidence, /ref:.*head-sha|contents: write|pull-requests: write|npm /);
  assert.match(evidence, /REVIEW_HEAD_SHA: \$\{\{ needs\.review-target\.outputs\.head-sha \}\}/);
  assert.match(evidence, /run: node scripts\/collect-sync-evidence\.mjs review sync-evidence\.json/);
  assert.equal(workflow.split('timeout-minutes: 9').length - 1, 2);
  const review = workflow.split('\n  review:')[1].split('\n  comment:')[0];
  assert.match(review, /prompt-file: \$\{\{ runner\.temp \}\}\/review-kencis.md/);
  assert.match(review, /name: review-evidence/);
  assert.ok(review.indexOf('preserve trusted review instructions') < review.indexOf('ref: ${{ needs.review-target'));
  assert.doesNotMatch(review, /OPENAI_API_KEY:/); // 원본 키는 Codex Action의 보호 프록시만 수신
});
