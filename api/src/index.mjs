// moto-kr 쿼리 API (Cloudflare Workers)
//
// 정적 JSON(CDN)이 벌크용이라면 이 API 는 필터용이다. 데이터는 빌드 산출물을
// 번들에 임베드하므로 런타임 외부 의존이 없다. 데이터가 갱신되면 재배포한다.
//
//   GET /            사용법
//   GET /models      필터 조회 (brand, category, ccMin, ccMax, from, to, status, electric, q, ...)
//   GET /brands      브랜드 목록과 기종 수
//   GET /meta        데이터 정보

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
        q: '이름·인증 차명 부분 일치 검색',
        limit: '최대 반환 수 (기본 전체)',
        offset: '건너뛸 수',
      },
      example: '/models?brand=혼다&ccMin=250&ccMax=800&category=스포츠',
      note: '인증 이력 전문은 정적 파일에서: https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/models.json',
    },
    'GET /brands': '브랜드 목록과 기종 수',
    'GET /meta': '데이터 생성일·집계',
  },
};

export default {
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const p = url.searchParams;

    if (path === '/') return json(USAGE);
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
      const brands = p.get('brand')?.split(',').map((s) => s.trim()).filter(Boolean);
      const categories = p.get('category')?.split(',').map((s) => s.trim()).filter(Boolean);
      const ccMin = p.has('ccMin') ? Number(p.get('ccMin')) : null;
      const ccMax = p.has('ccMax') ? Number(p.get('ccMax')) : null;
      const from = normDate(p.get('from'), false);
      const to = normDate(p.get('to'), true);
      const status = p.get('status');
      const electric = p.has('electric') ? p.get('electric') === 'true' : null;
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

    return json({ error: 'not found', usage: '/' }, 404);
  },
};
