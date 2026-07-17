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
// 전체 덤프는 GitHub raw 의 풀 JSON(10MB)을 스트리밍 프록시한다. 모든 GET 응답은
// 엣지 캐시(Cache API)에 얹히고, 캐시 키에 데이터 생성일이 들어가 재배포 시 자연 무효화된다.

import dataset from '../../data/models.lite.json' with { type: 'json' };

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

// from=2020 → 2020-01-01, to=2022 → 2022-12-31 로 보정해 날짜 문자열 비교
const normDate = (s, isTo) => {
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return isTo ? `${s}-12-31` : `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return isTo ? `${s}-31` : `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return undefined; // 형식 오류
};

const USAGE = {
  name: 'moto-kr API',
  description: '한국 정발 오토바이 기종 조회',
  repo: 'https://github.com/starhn87/moto-kr',
  endpoints: {
    'GET /models': {
      params: {
        brand: '브랜드. 콤마로 복수 지정 (예: 혼다,야마하)',
        category: '스포츠|네이키드|크루저|투어러|어드벤처|스쿠터|언더본|오프로드|클래식|미니|3륜. 콤마로 복수 지정',
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

const RAW_FULL = 'https://raw.githubusercontent.com/starhn87/moto-kr/main/data/models.json';

async function handle(url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const p = url.searchParams;

  if (path === '/') return json(USAGE);

  // 파라미터 없는 /models = 인증 이력 포함 전체 덤프 (풀 JSON 스트리밍 프록시)
  if (path === '/models' && [...p.keys()].length === 0) {
    const r = await fetch(RAW_FULL);
    if (!r.ok) return json({ error: '전체 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요' }, 502);
    return new Response(r.body, { headers: HEADERS });
  }
  {
  }
  if (path === '/meta') return json(dataset.meta);

  {
    if (path === '/brands') {
      const counts = new Map();
      for (const m of dataset.models) counts.set(m.brand, (counts.get(m.brand) ?? 0) + 1);
      const brands = [...counts.entries()]
        .map(([brand, count]) => ({ brand, count }))
        .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'ko'));
      return json({ total: brands.length, brands });
    }

    if (path === '/models') {
      const brands = p.get('brand')?.split(',').map((s) => s.trim()).filter(Boolean);
      const categories = p.get('category')?.split(',').map((s) => s.trim()).filter(Boolean);
      const ccMin = p.has('ccMin') ? Number(p.get('ccMin')) : null;
      const ccMax = p.has('ccMax') ? Number(p.get('ccMax')) : null;
      const from = normDate(p.get('from'), false);
      const to = normDate(p.get('to'), true);
      const status = p.get('status');
      const electric = p.has('electric') ? p.get('electric') === 'true' : null;
      const fuelGrade = p.get('fuelGrade');
      const emission = p.get('emission');
      const numOrNull = (k) => (p.has(k) ? Number(p.get(k)) : null);
      const seatHeightMin = numOrNull('seatHeightMin');
      const seatHeightMax = numOrNull('seatHeightMax');
      const weightMin = numOrNull('weightMin');
      const weightMax = numOrNull('weightMax');
      const cylinders = p.get('cylinders')?.split(',').map(Number).filter((n) => !Number.isNaN(n));
      const cooling = p.get('cooling');
      const fuelCapacityMin = numOrNull('fuelCapacityMin');
      const fuelCapacityMax = numOrNull('fuelCapacityMax');
      const powerMin = numOrNull('powerMin');
      const powerMax = numOrNull('powerMax');
      const q = p.get('q')?.trim();

      if ((ccMin !== null && Number.isNaN(ccMin)) || (ccMax !== null && Number.isNaN(ccMax))) {
        return json({ error: 'ccMin/ccMax 는 숫자여야 합니다' }, 400);
      }
      if (from === undefined || to === undefined) {
        return json({ error: 'from/to 형식은 YYYY, YYYY-MM, YYYY-MM-DD 입니다' }, 400);
      }
      if (status && status !== 'verified' && status !== 'curated') {
        return json({ error: 'status 는 verified 또는 curated 입니다' }, 400);
      }
      if (fuelGrade && fuelGrade !== 'regular' && fuelGrade !== 'premium') {
        return json({ error: 'fuelGrade 는 regular 또는 premium 입니다' }, 400);
      }
      if (emission && !['euro5', 'euro4', 'euro3'].includes(emission)) {
        return json({ error: 'emission 은 euro5, euro4, euro3 중 하나입니다' }, 400);
      }
      for (const [k, v] of [['seatHeightMin', seatHeightMin], ['seatHeightMax', seatHeightMax], ['weightMin', weightMin], ['weightMax', weightMax], ['fuelCapacityMin', fuelCapacityMin], ['fuelCapacityMax', fuelCapacityMax], ['powerMin', powerMin], ['powerMax', powerMax]]) {
        if (v !== null && Number.isNaN(v)) return json({ error: `${k} 는 숫자여야 합니다` }, 400);
      }
      if (cooling && !['air', 'liquid', 'oil'].includes(cooling)) {
        return json({ error: 'cooling 은 air, liquid, oil 중 하나입니다' }, 400);
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
      const offset = Math.max(0, Number(p.get('offset') ?? 0) || 0);
      const limit = p.has('limit') ? Math.max(0, Number(p.get('limit')) || 0) : null;
      out = limit === null ? out.slice(offset) : out.slice(offset, offset + limit);

      return json({
        meta: { generatedAt: dataset.meta.generatedAt, total, returned: out.length },
        models: out,
      });
    }

  }
  return json({ error: 'not found', usage: '/' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'GET only' }, 405);
    }
    const url = new URL(request.url);
    // 엣지 캐시: 키에 데이터 생성일을 넣어 재배포(데이터 갱신) 시 자연 무효화
    const cacheKey = new Request(
      `https://cache.moto-kr/${dataset.meta.generatedAt}${url.pathname}${url.search}`,
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
    const res = await handle(url);
    res.headers.set('x-cache', 'MISS');
    if (cache && res.status === 200) ctx?.waitUntil?.(cache.put(cacheKey, res.clone()));
    return res;
  },
};
