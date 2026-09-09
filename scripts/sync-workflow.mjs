// sync.yml에서 쓰는 PR 문구와 GitHub API 오케스트레이션을 코드로 분리한다.
// 사용: node scripts/sync-workflow.mjs <summary> <enrichment> <ai-status> <output>

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { hasValidatedSync, isPriorSyncCandidate, kstDate } from './sync-recovery.mjs';

export const REVIEW_COMMENT_MARKER = '<!-- codex-kencis-sync-review -->';

export const composeSyncPrBody = ({ summary, enrichment, aiStatus }) =>
  [
    '주간 자동 수집으로 감지된 KENCIS 인증 데이터 변경입니다.',
    '',
    summary.trimEnd(),
    '',
    enrichment.trimEnd(),
    '',
    `자동 보완 상태: \`${aiStatus}\``,
    '',
    'PR 생성 후 별도의 읽기 전용 AI 검증이 실제 HEAD를 다시 확인하고 상태 코멘트를 남깁니다.',
    '',
  ].join('\n');

const assertReview = (review) => {
  if (!review || !['ready', 'action_required'].includes(review.verdict)) throw new Error('AI review verdict is invalid');
  if (typeof review.summary !== 'string') throw new Error('AI review summary is invalid');
  if (!Array.isArray(review.findings) || !Array.isArray(review.checks)) throw new Error('AI review lists are invalid');
};

export const renderReviewComment = ({ reviewJson, reviewJobResult }) => {
  try {
    if (reviewJobResult !== 'success' || !reviewJson) throw new Error('AI review job did not return a result');
    const review = JSON.parse(reviewJson);
    assertReview(review);
    const ready = review.verdict === 'ready';
    const findings = review.findings.length
      ? review.findings.map((item) => `- **${item.severity} · ${item.title}** — ${item.detail}`).join('\n')
      : '- 조치가 필요한 발견 사항 없음';
    const checks = review.checks.length ? review.checks.map((item) => `- ${item}`).join('\n') : '- 기록된 검증 없음';
    return `${REVIEW_COMMENT_MARKER}\n## ${ready ? '✅ AI 검증: 이대로 머지 가능' : '⚠️ AI 검증: 추가 조치 필요'}\n\n${review.summary}\n\n### 발견 사항\n\n${findings}\n\n### 확인 내용\n\n${checks}`;
  } catch (error) {
    return `${REVIEW_COMMENT_MARKER}\n## ⚠️ AI 검증을 완료하지 못함\n\n자동 검증 결과를 만들지 못했습니다. 이 PR은 수동 확인 후 머지해 주세요.\n\n- 사유: ${error.message}`;
  }
};

export const checkEarlierSuccessfulSync = async ({ github, context, core, workflowId = 'sync.yml' }) => {
  if (context.eventName !== 'schedule') {
    core.setOutput('should-run', 'true');
    return true;
  }

  try {
    const current = await github.rest.actions.getWorkflowRun({
      owner: context.repo.owner,
      repo: context.repo.repo,
      run_id: context.runId,
    });
    const recoveryDate = kstDate(current.data.created_at);
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      workflow_id: workflowId,
      status: 'completed',
      per_page: 100,
    });

    for (const run of runs) {
      if (!isPriorSyncCandidate(run, context.runId, recoveryDate)) continue;
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        run_id: run.id,
        filter: 'latest',
        per_page: 100,
      });
      if (!hasValidatedSync(jobs)) continue;

      core.setOutput('should-run', 'false');
      core.notice(`오늘 동기화가 이미 성공해 이 복구 슬롯을 건너뜁니다: ${run.html_url}`);
      await core.summary
        .addHeading('KENCIS 동기화 생략')
        .addRaw(`오늘 성공한 [이전 실행 #${run.run_number}](${run.html_url})이 있어 중복 수집을 건너뜁니다.`)
        .write();
      return false;
    }
  } catch (error) {
    core.warning(`이전 실행 확인 실패; 동기화를 계속합니다: ${error.message}`);
  }

  core.setOutput('should-run', 'true');
  return true;
};

export const upsertReviewComment = async ({ github, context, pullRequestNumber, reviewJson, reviewJobResult }) => {
  const body = renderReviewComment({ reviewJson, reviewJobResult });
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pullRequestNumber,
    per_page: 100,
  });
  const previous = comments.find(
    (comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(REVIEW_COMMENT_MARKER),
  );
  if (previous) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: previous.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pullRequestNumber,
      body,
    });
  }
  return body;
};

const main = () => {
  const [, , summaryPath, enrichmentPath, aiStatus, outputPath] = process.argv;
  if (!summaryPath || !enrichmentPath || !aiStatus || !outputPath) {
    throw new Error('사용법: node scripts/sync-workflow.mjs <summary> <enrichment> <ai-status> <output>');
  }
  writeFileSync(
    outputPath,
    composeSyncPrBody({
      summary: readFileSync(summaryPath, 'utf8'),
      enrichment: readFileSync(enrichmentPath, 'utf8'),
      aiStatus,
    }),
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
