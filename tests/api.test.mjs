import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../api/src/index.mjs';

const call = async (query, env = {}) => {
  const pending = [];
  const response = await worker.fetch(
    new Request(`https://example.test/models?${query}`),
    env,
    { waitUntil: (promise) => pending.push(promise) },
  );
  await Promise.all(pending);
  return { response, body: await response.json() };
};

test('유효한 복합 필터와 페이징을 적용한다', async () => {
  const { response, body } = await call('electric=true&category=스쿠터&limit=5&offset=1');
  assert.equal(response.status, 200);
  assert.ok(body.meta.total > 1);
  assert.ok(body.models.length <= 5);
  assert.ok(body.models.every((model) => model.electric === true && model.category === '스쿠터'));
});

test('유효한 월 단위 날짜를 실제 말일로 처리한다', async () => {
  const { response } = await call('from=2024-02&to=2024-02');
  assert.equal(response.status, 200);
});

for (const [query, message] of [
  ['electric=banana', 'electric'],
  ['from=2026-13', 'from/to'],
  ['from=2024-02-30', 'from/to'],
  ['cylinders=x', 'cylinders'],
  ['limit=oops', 'limit'],
  ['offset=-4', 'offset'],
  ['ccMin=500&ccMax=125', 'ccMin'],
  ['category=잠수함', 'category'],
  ['brand=', 'brand'],
  ['status=', 'status'],
  ['cooling=', 'cooling'],
  ['q=', 'q'],
  ['typo=true', '지원하지 않는'],
]) {
  test(`잘못된 쿼리를 400으로 거부한다: ${query}`, async () => {
    const { response, body } = await call(query);
    assert.equal(response.status, 400);
    assert.match(body.error, new RegExp(message));
  });
}

test('limit=0은 유효하며 빈 페이지를 반환한다', async () => {
  const { response, body } = await call('limit=0');
  assert.equal(response.status, 200);
  assert.equal(body.models.length, 0);
  assert.equal(body.meta.returned, 0);
  assert.ok(body.meta.total > 0);
});

test('캐시 키에 배포 커밋을 포함한다', { concurrency: false }, async () => {
  const originalCaches = globalThis.caches;
  let matchedUrl;
  let storedUrl;
  globalThis.caches = {
    default: {
      match: async (request) => {
        matchedUrl = request.url;
        return undefined;
      },
      put: async (request) => {
        storedUrl = request.url;
      },
    },
  };

  try {
    const pending = [];
    const response = await worker.fetch(
      new Request('https://example.test/meta'),
      { GIT_SHA: 'abc123' },
      { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.match(matchedUrl, /\/abc123\/meta$/);
    assert.equal(storedUrl, matchedUrl);
  } finally {
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});
