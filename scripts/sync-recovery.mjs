// 같은 KST 날짜에 수집·검증·PR 게시까지 끝낸 동기화가 있는지 판정한다.
// AI 검토/코멘트 실패는 재수집 사유가 아니며, 게시 전 실패는 복구 기회를 남긴다.

const countedEvents = new Set(['schedule', 'workflow_dispatch']);

export const kstDate = (value) => new Date(
  new Date(value).getTime() + 9 * 60 * 60 * 1000,
).toISOString().slice(0, 10);

export const isPriorSyncCandidate = (run, currentRunId, recoveryDate) =>
  run.id !== currentRunId &&
  ['success', 'failure'].includes(run.conclusion) &&
  countedEvents.has(run.event) &&
  kstDate(run.created_at) === recoveryDate;

export const hasValidatedSync = (jobs) => {
  const prepared = jobs.find((job) => job.name === 'prepare');
  const published = jobs.find((job) => job.name === 'publish');
  const built = prepared?.steps?.some((step) =>
    step.name === 'build and validate raw sync' && step.conclusion === 'success',
  ) ?? false;
  return built && published?.conclusion === 'success' && (published.steps?.some((step) =>
    step.name === 'create or update sync PR' && step.conclusion === 'success',
  ) ?? false);
};
