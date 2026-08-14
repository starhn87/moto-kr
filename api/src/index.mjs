// moto-kr 쿼리 API (Cloudflare Workers)
//
// 정적 JSON(CDN)이 벌크용이라면 이 API 는 필터용이다. 데이터는 빌드 산출물을
// 번들에 임베드하므로 런타임 외부 의존이 없다. 데이터가 갱신되면 재배포한다.
//
//   GET /            사용법
//   GET /models      파라미터 없으면 전체 덤프(인증 이력 포함), 있으면 필터 조회(요약 스키마)
//   GET /brands      브랜드 목록과 기종 수
//   GET /meta        데이터 정보
//
// 전체 덤프는 jsDelivr의 풀 JSON을 스트리밍 프록시한다. 모든 GET 응답은
// 엣지 캐시(Cache API)에 얹히고, 캐시 키에 데이터 생성일과 배포 커밋을 넣는다.

import dataset from '../../data/models.lite.json' with { type: 'json' };

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const CATEGORIES = new Set([
  '스포츠', '네이키드', '크루저', '투어러', '어드벤처', '스쿠터',
  '언더본', '오프로드', '클래식', '미니', '3륜', '4륜',
]);
const KNOWN_PARAMS = new Set([
  'brand', 'category', 'ccMin', 'ccMax', 'from', 'to', 'status', 'electric',
  'fuelGrade', 'emission', 'seatHeightMin', 'seatHeightMax', 'weightMin',
  'weightMax', 'cylinders', 'cooling', 'fuelCapacityMin', 'fuelCapacityMax',
  'powerMin', 'powerMax', 'q', 'limit', 'offset',
]);

// from=2020 → 2020-01-01, to=2022 → 2022-12-31 로 보정해 날짜 문자열 비교
const normDate = (s, isTo) => {
  if (s === null) return null;
  if (/^\d{4}$/.test(s)) return isTo ? `${s}-12-31` : `${s}-01-01`;
  const month = s.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const year = Number(month[1]);
    const value = Number(month[2]);
    if (value < 1 || value > 12) return undefined;
    const day = isTo ? new Date(Date.UTC(year, value, 0)).getUTCDate() : 1;
    return `${month[1]}-${month[2]}-${String(day).padStart(2, '0')}`;
  }
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const year = Number(day[1]);
    const monthValue = Number(day[2]);
    const dayValue = Number(day[3]);
    if (monthValue < 1 || monthValue > 12) return undefined;
    const lastDay = new Date(Date.UTC(year, monthValue, 0)).getUTCDate();
    if (dayValue < 1 || dayValue > lastDay) return undefined;
    return s;
  }
  return undefined;
};

const numberParam = (params, key, { integer = false } = {}) => {
  if (!params.has(key)) return { value: null };
  const raw = params.get(key)?.trim() ?? '';
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    return { error: `${key} 는 0 이상의 ${integer ? '정수' : '숫자'}여야 합니다` };
  }
  return { value };
};

const csvParam = (params, key) => {
  if (!params.has(key)) return { value: null };
  const value = params.get(key).split(',').map((s) => s.trim()).filter(Boolean);
  return value.length ? { value } : { error: `${key} 값이 비어 있습니다` };
};

const USAGE = {
  name: 'moto-kr API',
  description: '한국 정발 오토바이 기종 조회',
  repo: 'https://github.com/starhn87/moto-kr',
  endpoints: {
    'GET /models': {
      params: {
        brand: '브랜드. 콤마로 복수 지정 (예: 혼다,야마하)',
        category: '스포츠|네이키드|크루저|투어러|어드벤처|스쿠터|언더본|오프로드|클래식|미니|3륜|4륜. 콤마로 복수 지정',
        ccMin: '배기량 하한 (cc)',
        ccMax: '배기량 상한 (cc)',
        from: '최초 인증일 하한 (2020 | 2020-06 | 2020-06-01)',
        to: '최초 인증일 상한',
        status: 'verified | curated',
        electric: 'true | false',
        fuelGrade: 'regular | premium (권장 연료)',
        emission: 'euro5 | euro4 | euro3 (배출 기준, 최신 인증 기준)',
        seatHeightMin: '시트고 하한 (mm)',
        seatHeightMax: '시트고 상한 (mm)',
        weightMin: '중량 하한 (kg)',
        weightMax: '중량 상한 (kg)',
        cylinders: '기통수. 콤마로 복수 지정 (예: 1,2)',
        cooling: 'air | liquid | oil (냉각 방식)',
        fuelCapacityMin: '연료탱크 하한 (L)',
        fuelCapacityMax: '연료탱크 상한 (L)',
        powerMin: '최고출력 하한 (PS)',
        powerMax: '최고출력 상한 (PS)',
        q: '이름·인증 차명 부분 일치 검색',
        limit: '최대 반환 수 (기본 전체)',
        offset: '건너뛸 수',
      },
      example: '/models?category=크루저&ccMin=800&fuelGrade=premium&emission=euro5&seatHeightMax=750',
      tip: '원동기 면허(125cc 이하) 기종은 ccMax=125 로 거른다',
      note: '파라미터 없이 /models 를 호출하면 인증 이력까지 포함한 전체 덤프를 반환한다. 필터 응답은 인증 이력 대신 certificationCount·offices 요약을 담는다',
    },
    'GET /brands': '브랜드 목록과 기종 수',
    'GET /meta': '데이터 생성일·집계',
  },
};

// 전체 덤프 원본. 배포 시 GIT_SHA(커밋 고정)를 주입하면 jsDelivr 영구 캐시를 타고
// 미주입(로컬 wrangler deploy)이면 @main 으로 폴백한다 (jsDelivr 캐시 최대 12시간)
const fullUrl = (env) =>
  `https://cdn.jsdelivr.net/gh/starhn87/moto-kr@${env?.GIT_SHA ?? 'main'}/data/models.json`;

async function handle(url, env) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const p = url.searchParams;

  if (path === '/') return json(USAGE);

  // 파라미터 없는 /models = 인증 이력 포함 전체 덤프 (풀 JSON 스트리밍 프록시)
  if (path === '/models' && [...p.keys()].length === 0) {
    const r = await fetch(fullUrl(env));
    if (!r.ok) {
      return json({ error: `전체 데이터를 가져오지 못했습니다 (upstream ${r.status}). 잠시 후 다시 시도해 주세요` }, 502);
    }
    return new Response(r.body, { headers: HEADERS });
  }
  if (path === '/meta') return json(dataset.meta);

  if (path === '/brands') {
    const counts = new Map();
    for (const m of dataset.models) counts.set(m.brand, (counts.get(m.brand) ?? 0) + 1);
    const brands = [...counts.entries()]
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'ko'));
    return json({ total: brands.length, brands });
  }

  if (path === '/models') {
    for (const key of p.keys()) {
      if (!KNOWN_PARAMS.has(key)) return json({ error: `지원하지 않는 파라미터입니다: ${key}` }, 400);
    }

    const brandParam = csvParam(p, 'brand');
    const categoryParam = csvParam(p, 'category');
    if (brandParam.error) return json({ error: brandParam.error }, 400);
    if (categoryParam.error) return json({ error: categoryParam.error }, 400);
    const brands = brandParam.value;
    const categories = categoryParam.value;
    if (categories) {
      const invalid = categories.filter((category) => !CATEGORIES.has(category));
      if (invalid.length) return json({ error: `지원하지 않는 category: ${invalid.join(', ')}` }, 400);
    }

    const numericKeys = [
      'ccMin', 'ccMax', 'seatHeightMin', 'seatHeightMax', 'weightMin', 'weightMax',
      'fuelCapacityMin', 'fuelCapacityMax', 'powerMin', 'powerMax',
    ];
    const numbers = {};
    for (const key of numericKeys) {
      const parsed = numberParam(p, key);
      if (parsed.error) return json({ error: parsed.error }, 400);
      numbers[key] = parsed.value;
    }
    const offsetParam = numberParam(p, 'offset', { integer: true });
    const limitParam = numberParam(p, 'limit', { integer: true });
    if (offsetParam.error) return json({ error: offsetParam.error }, 400);
    if (limitParam.error) return json({ error: limitParam.error }, 400);
    const offset = offsetParam.value ?? 0;
    const limit = limitParam.value;

    const {
      ccMin, ccMax, seatHeightMin, seatHeightMax, weightMin, weightMax,
      fuelCapacityMin, fuelCapacityMax, powerMin, powerMax,
    } = numbers;
    const from = normDate(p.get('from'), false);
    const to = normDate(p.get('to'), true);
    const status = p.get('status');
    const electricRaw = p.get('electric');
    if (electricRaw !== null && electricRaw !== 'true' && electricRaw !== 'false') {
      return json({ error: 'electric 은 true 또는 false 입니다' }, 400);
    }
    const electric = electricRaw === null ? null : electricRaw === 'true';
    const fuelGrade = p.get('fuelGrade');
    const emission = p.get('emission');
    const cylinderParam = csvParam(p, 'cylinders');
    if (cylinderParam.error) return json({ error: cylinderParam.error }, 400);
    let cylinders = null;
    if (cylinderParam.value) {
      cylinders = cylinderParam.value.map(Number);
      if (cylinders.some((n) => ![1, 2, 3, 4, 6].includes(n))) {
        return json({ error: 'cylinders 는 1, 2, 3, 4, 6 중 하나 이상이어야 합니다' }, 400);
      }
    }
    const cooling = p.get('cooling');
    const q = p.get('q')?.trim();

    if (from === undefined || to === undefined) {
      return json({ error: 'from/to 는 유효한 YYYY, YYYY-MM, YYYY-MM-DD 날짜여야 합니다' }, 400);
    }
    if (from && to && from > to) return json({ error: 'from 은 to 보다 늦을 수 없습니다' }, 400);
    if (status !== null && status !== 'verified' && status !== 'curated') {
      return json({ error: 'status 는 verified 또는 curated 입니다' }, 400);
    }
    if (fuelGrade !== null && fuelGrade !== 'regular' && fuelGrade !== 'premium') {
      return json({ error: 'fuelGrade 는 regular 또는 premium 입니다' }, 400);
    }
    if (emission !== null && !['euro5', 'euro4', 'euro3'].includes(emission)) {
      return json({ error: 'emission 은 euro5, euro4, euro3 중 하나입니다' }, 400);
    }
    if (cooling !== null && !['air', 'liquid', 'oil'].includes(cooling)) {
      return json({ error: 'cooling 은 air, liquid, oil 중 하나입니다' }, 400);
    }
    if (p.has('q') && !q) return json({ error: 'q 값이 비어 있습니다' }, 400);
    for (const [minKey, maxKey] of [
      ['ccMin', 'ccMax'], ['seatHeightMin', 'seatHeightMax'], ['weightMin', 'weightMax'],
      ['fuelCapacityMin', 'fuelCapacityMax'], ['powerMin', 'powerMax'],
    ]) {
      if (numbers[minKey] !== null && numbers[maxKey] !== null && numbers[minKey] > numbers[maxKey]) {
        return json({ error: `${minKey} 은 ${maxKey} 보다 클 수 없습니다` }, 400);
      }
    }

    const qNorm = q?.toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');

    let out = dataset.models.filter((m) => {
      if (brands && !brands.includes(m.brand)) return false;
      if (categories && !categories.includes(m.category)) return false;
      if (ccMin !== null && (m.displacement === null || m.displacement < ccMin)) return false;
      if (ccMax !== null && (m.displacement === null || m.displacement > ccMax)) return false;
      if (from && (!m.firstCertifiedAt || m.firstCertifiedAt < from)) return false;
      if (to && (!m.firstCertifiedAt || m.firstCertifiedAt > to)) return false;
      if (status && m.status !== status) return false;
      if (electric !== null && m.electric !== electric) return false;
      if (fuelGrade && m.fuelGrade !== fuelGrade) return false;
      if (emission && m.emissionStandard !== emission) return false;
      if (seatHeightMin !== null && (m.seatHeight === null || m.seatHeight < seatHeightMin)) return false;
      if (seatHeightMax !== null && (m.seatHeight === null || m.seatHeight > seatHeightMax)) return false;
      if (weightMin !== null && (m.weight === null || m.weight < weightMin)) return false;
      if (weightMax !== null && (m.weight === null || m.weight > weightMax)) return false;
      if (cylinders?.length && !cylinders.includes(m.cylinders)) return false;
      if (cooling && m.cooling !== cooling) return false;
      if (fuelCapacityMin !== null && (m.fuelCapacity === null || m.fuelCapacity < fuelCapacityMin)) return false;
      if (fuelCapacityMax !== null && (m.fuelCapacity === null || m.fuelCapacity > fuelCapacityMax)) return false;
      if (powerMin !== null && (m.power === null || m.power < powerMin)) return false;
      if (powerMax !== null && (m.power === null || m.power > powerMax)) return false;
      if (qNorm) {
        const hay = [m.nameKo, ...(m.aliases ?? [])]
          .join('|')
          .toUpperCase()
          .replace(/[^A-Z0-9가-힣|]/g, '');
        if (!hay.includes(qNorm)) return false;
      }
      return true;
    });

    const total = out.length;
    out = limit === null ? out.slice(offset) : out.slice(offset, offset + limit);

    return json({
      meta: { generatedAt: dataset.meta.generatedAt, total, returned: out.length },
      models: out,
    });
  }
  return json({ error: 'not found', usage: '/' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'GET only' }, 405);
    }
    const url = new URL(request.url);
    // 데이터 생성일과 배포 커밋을 모두 키에 넣는다. 데이터가 같아도 API 로직만
    // 바뀐 배포라면 이전 응답을 재사용하지 않는다.
    const cacheVersion = env?.GIT_SHA ?? dataset.meta.generatedAt;
    const cacheKey = new Request(
      `https://cache.moto-kr/${dataset.meta.generatedAt}/${cacheVersion}${url.pathname}${url.search}`,
    );
    const cache = globalThis.caches?.default;
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('x-cache', 'HIT');
        return res;
      }
    }
    const res = await handle(url, env);
    res.headers.set('x-cache', 'MISS');
    if (cache && res.status === 200) ctx?.waitUntil?.(cache.put(cacheKey, res.clone()));
    return res;
  },
};
