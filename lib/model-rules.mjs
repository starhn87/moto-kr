// 모델 데이터와 API가 공유하는 도메인 규칙. 배열은 JSON Schema와 문서 생성에도
// 재사용할 수 있도록 Set 대신 직렬화 가능한 값으로 노출한다.

export const CATEGORIES = Object.freeze([
  '스포츠', '네이키드', '크루저', '투어러', '어드벤처', '스쿠터',
  '언더본', '오프로드', '클래식', '미니', '3륜', '4륜',
]);
export const FUEL_GRADES = Object.freeze(['regular', 'premium']);
export const COOLING_TYPES = Object.freeze(['air', 'liquid', 'oil']);
export const CYLINDER_COUNTS = Object.freeze([1, 2, 3, 4, 6]);

export const MODEL_KEYS = Object.freeze([
  'nameKo', 'brand', 'model', 'aliases', 'displacement', 'category', 'electric',
  'fuelGrade', 'seatHeight', 'weight', 'cylinders', 'cooling', 'fuelCapacity', 'power',
]);

const ROMAN_BASE = 0x2160; // Ⅰ

export const normalizeVehicleName = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[Ⅰ-Ⅻ]/g, (character) => String(character.codePointAt(0) - ROMAN_BASE + 1))
    .replace(/[^A-Z0-9가-힣]/g, '');

export const isCanonicalModelName = ({ nameKo, brand, model }) =>
  (nameKo === brand && model === brand) || nameKo === `${brand} ${model}`;

export const isPositiveIntegerOrNull = (value) =>
  value == null || (Number.isInteger(value) && value > 0);

export const isPositiveNumberOrNull = (value) =>
  value == null || (Number.isFinite(value) && value > 0);

export const isAllowedCategory = (value) => value == null || CATEGORIES.includes(value);
export const isAllowedFuelGrade = (value) => value == null || FUEL_GRADES.includes(value);
export const isAllowedCooling = (value) => value == null || COOLING_TYPES.includes(value);
export const isAllowedCylinderCount = (value) => value == null || CYLINDER_COUNTS.includes(value);
