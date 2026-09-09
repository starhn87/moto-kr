const DEFAULT_BASE_URL = 'https://apis.data.go.kr/1480523/Kencis/getVems';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const describeRequestError = (error) => {
  const cause = error?.cause;
  if (cause?.code) return `${cause.code}: ${cause.message}`;
  return error?.message ?? String(error);
};

const fetchWithTimeout = async (fetchImpl, url, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`요청 시간 초과 (${timeoutMs}ms)`);
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchKencisPage = async ({
  url,
  page,
  fetchImpl = fetch,
  sleep = wait,
  maxAttempts = 3,
  retryBaseMs = 2_000,
  retryMaxMs = 30_000,
  timeoutMs = 20_000,
  onRetry = () => {},
}) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} (page ${page}, attempt ${attempt})`);
        if (response.status !== 429 && response.status < 500) {
          error.retryable = false;
          throw error;
        }
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
      if (attempt === maxAttempts) break;
    }
    if (attempt < maxAttempts) {
      const delay = Math.min(retryBaseMs * 2 ** (attempt - 1), retryMaxMs);
      onRetry({ page, attempt, maxAttempts, delay, error: lastError });
      await sleep(delay);
    }
  }
  throw lastError;
};

export const fetchKencisGroup = async ({
  gubun,
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  rowsPerPage = 1000,
  onProgress = () => {},
  ...requestOptions
}) => {
  const motorcycles = [];
  let total = null;
  let fetched = 0;
  for (let page = 1; ; page++) {
    const url =
      `${baseUrl}?serviceKey=${apiKey}&pageNo=${page}` +
      `&numOfRows=${rowsPerPage}&resultType=json&gubun=${gubun}`;
    const body = await fetchKencisPage({ url, page, ...requestOptions });
    const response = body.getVems;
    if (response?.header?.code && response.header.code !== '00') {
      throw new Error(`API error: ${response.header.code} ${response.header.message}`);
    }
    const pageTotal = Number(response?.totalCount);
    if (!Number.isSafeInteger(pageTotal) || pageTotal < 0) {
      throw new Error(`API totalCount 이상: ${response?.totalCount} (gubun=${gubun}, page=${page})`);
    }
    if (total === null) total = pageTotal;
    if (pageTotal !== total) {
      throw new Error(`수집 중 totalCount 변경: ${total} → ${pageTotal} (gubun=${gubun}, page=${page})`);
    }
    const items = Array.isArray(response.item) ? response.item : response.item ? [response.item] : [];
    fetched += items.length;
    if (fetched > total) {
      throw new Error(`totalCount 초과 수집: ${fetched}/${total} (gubun=${gubun})`);
    }
    for (const item of items) {
      if ((item.CARTYPE ?? '').includes('이륜')) motorcycles.push(item);
    }
    onProgress({ gubun, fetched, total, motorcycles: motorcycles.length });
    if (fetched === total) break;
    if (items.length < rowsPerPage) {
      throw new Error(`페이지가 중간에 잘렸습니다: ${fetched}/${total} (gubun=${gubun}, page=${page})`);
    }
  }
  return motorcycles;
};

const sortKey = (row) =>
  `${row.EMIS_CERTI_DATE ?? row.NOISE_CERTI_DATE ?? ''}|${row.VEH_NM}|${row.VEH_TYPE}|${row.EMIS_CERTI_NO ?? row.NOISE_CERTI_NO ?? ''}`;

export const compareKencisRows = (left, right) =>
  sortKey(left) < sortKey(right) ? -1 : sortKey(left) > sortKey(right) ? 1 : 0;

export const dedupeKencisRows = (rows) => {
  const seen = new Set();
  return rows.filter((row) => {
    const key = JSON.stringify(row, Object.keys(row).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const assertNoUnexpectedShrink = (label, previousCount, rows, allowShrink = false) => {
  if (previousCount !== null && rows.length < previousCount && !allowShrink) {
    throw new Error(
      `${label} 인증이 ${previousCount}건에서 ${rows.length}건으로 감소했습니다. ` +
        'API 이상이 아닌 의도된 감소라면 ALLOW_KENCIS_SHRINK=1 로 다시 실행하세요.',
    );
  }
};
