import { CATEGORIES, COOLING_TYPES, CYLINDER_COUNTS, FUEL_GRADES } from '../../lib/model-rules.mjs';

export const MODEL_QUERY_PARAMS = {
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
};

const NUMERIC_KEYS = [
  'ccMin',
  'ccMax',
  'seatHeightMin',
  'seatHeightMax',
  'weightMin',
  'weightMax',
  'fuelCapacityMin',
  'fuelCapacityMax',
  'powerMin',
  'powerMax',
];
const RANGES = [
  ['ccMin', 'ccMax'],
  ['seatHeightMin', 'seatHeightMax'],
  ['weightMin', 'weightMax'],
  ['fuelCapacityMin', 'fuelCapacityMax'],
  ['powerMin', 'powerMax'],
];

// from=2020 → 2020-01-01, to=2022 → 2022-12-31 로 보정한다.
export const normalizeQueryDate = (value, isTo) => {
  if (value === null) return null;
  if (/^\d{4}$/.test(value)) return isTo ? `${value}-12-31` : `${value}-01-01`;
  const month = value.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const year = Number(month[1]);
    const monthValue = Number(month[2]);
    if (monthValue < 1 || monthValue > 12) return undefined;
    const day = isTo ? new Date(Date.UTC(year, monthValue, 0)).getUTCDate() : 1;
    return `${month[1]}-${month[2]}-${String(day).padStart(2, '0')}`;
  }
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const year = Number(day[1]);
    const monthValue = Number(day[2]);
    const dayValue = Number(day[3]);
    if (monthValue < 1 || monthValue > 12) return undefined;
    const lastDay = new Date(Date.UTC(year, monthValue, 0)).getUTCDate();
    if (dayValue < 1 || dayValue > lastDay) return undefined;
    return value;
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
  const value = params.get(key).split(',').map((item) => item.trim()).filter(Boolean);
  return value.length ? { value } : { error: `${key} 값이 비어 있습니다` };
};

const queryError = (error) => ({ error });

export const parseModelQuery = (params) => {
  for (const key of params.keys()) {
    if (!Object.hasOwn(MODEL_QUERY_PARAMS, key)) return queryError(`지원하지 않는 파라미터입니다: ${key}`);
  }

  const brand = csvParam(params, 'brand');
  const category = csvParam(params, 'category');
  if (brand.error) return queryError(brand.error);
  if (category.error) return queryError(category.error);
  if (category.value) {
    const invalid = category.value.filter((value) => !CATEGORIES.includes(value));
    if (invalid.length) return queryError(`지원하지 않는 category: ${invalid.join(', ')}`);
  }

  const numbers = {};
  for (const key of NUMERIC_KEYS) {
    const parsed = numberParam(params, key);
    if (parsed.error) return queryError(parsed.error);
    numbers[key] = parsed.value;
  }
  for (const [minimum, maximum] of RANGES) {
    if (numbers[minimum] !== null && numbers[maximum] !== null && numbers[minimum] > numbers[maximum]) {
      return queryError(`${minimum} 은 ${maximum} 보다 클 수 없습니다`);
    }
  }

  const offset = numberParam(params, 'offset', { integer: true });
  const limit = numberParam(params, 'limit', { integer: true });
  if (offset.error) return queryError(offset.error);
  if (limit.error) return queryError(limit.error);

  const from = normalizeQueryDate(params.get('from'), false);
  const to = normalizeQueryDate(params.get('to'), true);
  if (from === undefined || to === undefined) {
    return queryError('from/to 는 유효한 YYYY, YYYY-MM, YYYY-MM-DD 날짜여야 합니다');
  }
  if (from && to && from > to) return queryError('from 은 to 보다 늦을 수 없습니다');

  const status = params.get('status');
  if (status !== null && !['verified', 'curated'].includes(status)) {
    return queryError('status 는 verified 또는 curated 입니다');
  }
  const electricRaw = params.get('electric');
  if (electricRaw !== null && !['true', 'false'].includes(electricRaw)) {
    return queryError('electric 은 true 또는 false 입니다');
  }
  const fuelGrade = params.get('fuelGrade');
  if (fuelGrade !== null && !FUEL_GRADES.includes(fuelGrade)) {
    return queryError('fuelGrade 는 regular 또는 premium 입니다');
  }
  const emission = params.get('emission');
  if (emission !== null && !['euro5', 'euro4', 'euro3'].includes(emission)) {
    return queryError('emission 은 euro5, euro4, euro3 중 하나입니다');
  }
  const cylindersParam = csvParam(params, 'cylinders');
  if (cylindersParam.error) return queryError(cylindersParam.error);
  const cylinders = cylindersParam.value?.map(Number) ?? null;
  if (cylinders?.some((value) => !CYLINDER_COUNTS.includes(value))) {
    return queryError('cylinders 는 1, 2, 3, 4, 6 중 하나 이상이어야 합니다');
  }
  const cooling = params.get('cooling');
  if (cooling !== null && !COOLING_TYPES.includes(cooling)) {
    return queryError('cooling 은 air, liquid, oil 중 하나입니다');
  }
  const q = params.get('q')?.trim();
  if (params.has('q') && !q) return queryError('q 값이 비어 있습니다');

  return {
    query: {
      brands: brand.value,
      categories: category.value,
      ...numbers,
      from,
      to,
      status,
      electric: electricRaw === null ? null : electricRaw === 'true',
      fuelGrade,
      emission,
      cylinders,
      cooling,
      q: q?.toUpperCase().replace(/[^A-Z0-9가-힣]/g, '') ?? null,
      offset: offset.value ?? 0,
      limit: limit.value,
    },
  };
};

const outsideRange = (value, minimum, maximum) =>
  (minimum !== null && (value === null || value < minimum)) ||
  (maximum !== null && (value === null || value > maximum));

export const filterModels = (models, query) => {
  const filtered = models.filter((model) => {
    if (query.brands && !query.brands.includes(model.brand)) return false;
    if (query.categories && !query.categories.includes(model.category)) return false;
    if (outsideRange(model.displacement, query.ccMin, query.ccMax)) return false;
    if (query.from && (!model.firstCertifiedAt || model.firstCertifiedAt < query.from)) return false;
    if (query.to && (!model.firstCertifiedAt || model.firstCertifiedAt > query.to)) return false;
    if (query.status && model.status !== query.status) return false;
    if (query.electric !== null && model.electric !== query.electric) return false;
    if (query.fuelGrade && model.fuelGrade !== query.fuelGrade) return false;
    if (query.emission && model.emissionStandard !== query.emission) return false;
    if (outsideRange(model.seatHeight, query.seatHeightMin, query.seatHeightMax)) return false;
    if (outsideRange(model.weight, query.weightMin, query.weightMax)) return false;
    if (query.cylinders?.length && !query.cylinders.includes(model.cylinders)) return false;
    if (query.cooling && model.cooling !== query.cooling) return false;
    if (outsideRange(model.fuelCapacity, query.fuelCapacityMin, query.fuelCapacityMax)) return false;
    if (outsideRange(model.power, query.powerMin, query.powerMax)) return false;
    if (query.q) {
      const searchable = [model.nameKo, ...(model.aliases ?? [])]
        .join('|')
        .toUpperCase()
        .replace(/[^A-Z0-9가-힣|]/g, '');
      if (!searchable.includes(query.q)) return false;
    }
    return true;
  });
  const modelsPage =
    query.limit === null
      ? filtered.slice(query.offset)
      : filtered.slice(query.offset, query.offset + query.limit);
  return { total: filtered.length, models: modelsPage };
};
