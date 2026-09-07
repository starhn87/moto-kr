// 같은 KST 날짜에 실제 수집·빌드까지 끝낸 동기화가 있는지 판정한다.
// 예약 API 장애를 경고 종료한 실행은 workflow conclusion이 success여도 완료로 세지 않는다.

const countedEvents = new Set(['schedule', 'workflow_dispatch']);

export const kstDate = (value) => new Date(
  new Date(value).getTime() + 9 * 60 * 60 * 1000,
).toISOString().slice(0, 10);

export const isPriorSyncCandidate = (run, currentRunId, recoveryDate) =>
  run.id !== currentRunId &&
  run.conclusion === 'success' &&
  countedEvents.has(run.event) &&
  kstDate(run.created_at) === recoveryDate;

export const hasValidatedSync = (jobs) => {
  const prepared = jobs.find((job) => job.name === 'prepare');
  return prepared?.steps?.some((step) =>
    step.name === 'build and validate raw sync' && step.conclusion === 'success',
  ) ?? false;
};
