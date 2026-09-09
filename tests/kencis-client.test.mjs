import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoUnexpectedShrink,
  dedupeKencisRows,
  fetchKencisGroup,
  fetchKencisPage,
} from '../scripts/kencis-client.mjs';

const response = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });

test('429와 서버 오류를 지수 백오프로 재시도한다', async () => {
  const responses = [response({}, { ok: false, status: 429 }), response({}, { ok: false, status: 503 }), response({ ok: true })];
  const delays = [];
  const body = await fetchKencisPage({
    url: 'https://example.test',
    page: 1,
    fetchImpl: async () => responses.shift(),
    sleep: async (delay) => delays.push(delay),
    retryBaseMs: 10,
    retryMaxMs: 15,
  });

  assert.deepEqual(body, { ok: true });
  assert.deepEqual(delays, [10, 15]);
});

test('재시도할 수 없는 4xx 응답은 즉시 실패한다', async () => {
  let calls = 0;
  await assert.rejects(
    fetchKencisPage({
      url: 'https://example.test',
      page: 2,
      fetchImpl: async () => {
        calls++;
        return response({}, { ok: false, status: 400 });
      },
      sleep: async () => {},
    }),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

test('응답이 멈추면 요청 제한시간 후 재시도하고 실패한다', async () => {
  let calls = 0;
  await assert.rejects(
    fetchKencisPage({
      url: 'https://example.test',
      page: 3,
      maxAttempts: 2,
      timeoutMs: 5,
      sleep: async () => {},
      fetchImpl: async (_url, { signal }) => {
        calls++;
        return await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      },
    }),
    /요청 시간 초과/,
  );
  assert.equal(calls, 2);
});

test('모든 페이지를 받고 이륜차만 남긴다', async () => {
  const pages = [
    { getVems: { header: { code: '00' }, totalCount: 3, item: [{ CARTYPE: '이륜자동차', id: 1 }, { CARTYPE: '승용차', id: 2 }] } },
    { getVems: { header: { code: '00' }, totalCount: 3, item: { CARTYPE: '이륜자동차', id: 3 } } },
  ];
  const progress = [];
  const rows = await fetchKencisGroup({
    gubun: 1,
    apiKey: 'key',
    rowsPerPage: 2,
    fetchImpl: async () => response(pages.shift()),
    onProgress: (state) => progress.push(state.fetched),
  });

  assert.deepEqual(rows.map((row) => row.id), [1, 3]);
  assert.deepEqual(progress, [2, 3]);
});

test('수집 도중 totalCount가 바뀌거나 페이지가 잘리면 거부한다', async () => {
  await assert.rejects(
    fetchKencisGroup({
      gubun: 2,
      apiKey: 'key',
      rowsPerPage: 2,
      fetchImpl: async () => response({ getVems: { totalCount: 3, item: [{ CARTYPE: '이륜' }] } }),
    }),
    /페이지가 중간에 잘렸습니다/,
  );
});

test('완전히 같은 행만 중복 제거하고 비정상 감소를 막는다', () => {
  const rows = [{ B: 2, A: 1 }, { A: 1, B: 2 }, { A: 2, B: 2 }];
  assert.deepEqual(dedupeKencisRows(rows), [rows[0], rows[2]]);
  assert.throws(() => assertNoUnexpectedShrink('수입제작', 3, rows.slice(0, 2)), /3건에서 2건/);
  assert.doesNotThrow(() => assertNoUnexpectedShrink('수입제작', 3, rows.slice(0, 2), true));
});
