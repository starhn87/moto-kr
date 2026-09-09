// moto-kr 쿼리 API (Cloudflare Workers)
//
//   GET /            사용법
//   GET /models      파라미터 없으면 전체 덤프, 있으면 필터 조회
//   GET /brands      브랜드 목록과 기종 수
//   GET /meta        데이터 정보

import dataset from '../../data/models.lite.json' with { type: 'json' };

import { MODEL_QUERY_PARAMS, filterModels, parseModelQuery } from './model-query.mjs';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const USAGE = {
  name: 'moto-kr API',
  description: '한국 정발 오토바이 기종 조회',
  repo: 'https://github.com/starhn87/moto-kr',
  endpoints: {
    'GET /models': {
      params: MODEL_QUERY_PARAMS,
      example: '/models?category=크루저&ccMin=800&fuelGrade=premium&emission=euro5&seatHeightMax=750',
      tip: '원동기 면허(125cc 이하) 기종은 ccMax=125 로 거른다',
      note: '파라미터 없이 /models 를 호출하면 인증 이력까지 포함한 전체 덤프를 반환한다. 필터 응답은 인증 이력 대신 certificationCount·offices 요약을 담는다',
    },
    'GET /brands': '브랜드 목록과 기종 수',
    'GET /meta': '데이터 생성일·집계',
  },
};

const fullUrl = (env) =>
  `https://cdn.jsdelivr.net/gh/starhn87/moto-kr@${env?.GIT_SHA ?? 'main'}/data/models.json`;

const handle = async (url, env) => {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = url.searchParams;
  if (path === '/') return json(USAGE);

  if (path === '/models' && [...params.keys()].length === 0) {
    const response = await fetch(fullUrl(env));
    if (!response.ok) {
      return json({ error: `전체 데이터를 가져오지 못했습니다 (upstream ${response.status}). 잠시 후 다시 시도해 주세요` }, 502);
    }
    return new Response(response.body, { headers: HEADERS });
  }
  if (path === '/meta') return json(dataset.meta);
  if (path === '/brands') {
    const counts = new Map();
    for (const model of dataset.models) counts.set(model.brand, (counts.get(model.brand) ?? 0) + 1);
    const brands = [...counts.entries()]
      .map(([brand, count]) => ({ brand, count }))
      .sort((left, right) => right.count - left.count || left.brand.localeCompare(right.brand, 'ko'));
    return json({ total: brands.length, brands });
  }
  if (path === '/models') {
    const parsed = parseModelQuery(params);
    if (parsed.error) return json({ error: parsed.error }, 400);
    const result = filterModels(dataset.models, parsed.query);
    return json({
      meta: { generatedAt: dataset.meta.generatedAt, total: result.total, returned: result.models.length },
      models: result.models,
    });
  }
  return json({ error: 'not found', usage: '/' }, 404);
};

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'GET only' }, 405);
    const url = new URL(request.url);
    // 데이터 생성일과 배포 커밋을 모두 키에 넣어 API 로직만 바뀐 배포도 새 응답을 만든다.
    const cacheVersion = env?.GIT_SHA ?? dataset.meta.generatedAt;
    const cacheKey = new Request(
      `https://cache.moto-kr/${dataset.meta.generatedAt}/${cacheVersion}${url.pathname}${url.search}`,
    );
    const cache = globalThis.caches?.default;
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const response = new Response(hit.body, hit);
        response.headers.set('x-cache', 'HIT');
        return response;
      }
    }
    const response = await handle(url, env);
    response.headers.set('x-cache', 'MISS');
    if (cache && response.status === 200) ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
    return response;
  },
};
