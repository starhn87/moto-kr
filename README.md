<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
    <img src="docs/logo.png" width="128" alt="moto-kr 로고">
  </picture>
</p>

# moto-kr

한국에서 인증된 이륜차의 모델명, 제원, 인증 이력을 조회하는 오픈소스 API입니다.

KENCIS 배출가스·소음 인증에 쓰인 차명을 국내에서 사용하는 모델명과 연결했습니다. 배기량, 차종, 브랜드 등으로 검색할 수 있으며, 같은 모델의 인증 이력을 함께 제공합니다.

## API

기본 주소는 `https://moto-kr.starhn87.workers.dev`입니다. API 키가 필요하지 않으며, CORS를 허용하므로 브라우저에서도 호출할 수 있습니다.

```text
GET /models                                  # 전체 데이터 (인증 이력 포함)
GET /models?category=크루저&ccMin=800          # 조건에 맞는 모델 (요약 형식)
GET /brands                                  # 브랜드 목록과 기종 수
GET /meta                                    # 데이터 생성일과 집계
```

`/models`는 파라미터 없이 호출하면 전체 데이터를 반환합니다. 필터나 페이징 파라미터를 지정하면 개별 인증 이력 대신 인증 건수와 업체 목록을 담은 요약 응답을 반환합니다.

### 필터 파라미터

| 파라미터 | 설명 |
|---|---|
| `brand`, `category` | 콤마로 복수 지정 (예: `brand=혼다,야마하`) |
| `ccMin`, `ccMax` | 배기량 범위 (cc) |
| `from`, `to` | 최초 인증일 범위 (`2020`, `2020-06`, `2020-06-01`) |
| `cylinders` | 기통수, 콤마로 복수 지정 |
| `cooling` | `air` / `liquid` / `oil` |
| `fuelGrade` | `regular` / `premium` |
| `emission` | `euro5` / `euro4` / `euro3` |
| `seatHeightMin`, `seatHeightMax` | 시트고 범위 (mm) |
| `weightMin`, `weightMax` | 중량 범위 (kg) |
| `fuelCapacityMin`, `fuelCapacityMax` | 연료탱크 용량 범위 (L) |
| `powerMin`, `powerMax` | 최고출력 범위 (PS) |
| `electric` | 전기 구동 여부: `true` / `false` |
| `status` | 인증 연결 여부: `verified` / `curated` |
| `q` | 모델명·인증 차명 검색 |
| `limit`, `offset` | 반환할 모델 수, 건너뛸 모델 수 |

예를 들어 `ccMax=125`는 배기량이 125cc 이하인 모델을 조회합니다. 지원하지 않는 파라미터, 잘못된 숫자·날짜, 허용 목록에 없는 값에는 `400`을 반환합니다.

### 정적 JSON 파일

API 대신 [jsDelivr CDN](https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/)에서 파일을 직접 받을 수도 있습니다.

| 파일 | 내용 |
|---|---|
| `models.json` | 전체 모델과 인증 이력 |
| `models.lite.json` | 인증 건수·업체 목록을 포함한 모델 요약 |
| `models.min.json` | 모델명 배열 |
| `unmapped.json` | 미매핑·모호한 차명과 매핑 제외 항목 |

`@main` 주소는 CDN 캐시 때문에 저장소의 변경 사항이 늦게 반영될 수 있습니다. 특정 버전이 필요하면 `@main`을 커밋 해시나 태그로 바꾸세요. 모델 전체가 필요하지 않으면 API의 필터와 `limit`, `offset`을 사용하면 됩니다.

### 응답 예시 (models.json)

아래는 응답 구조를 보여주기 위한 예시입니다. 현재 기종 수와 데이터 생성일은 `/meta`에서 확인할 수 있습니다.

```jsonc
{
  "meta": {
    "generatedAt": "2026-07-17",
    "source": "KENCIS 자동차 배출가스·소음 인증 (data.go.kr 15000988)",
    "counts": { "models": 1142, "verified": 984, "curated": 158, "certifications": 4921, "unmapped": 14, "ambiguous": 0, "excluded": 12 }
  },
  "models": [
    {
      "nameKo": "혼다 CBR650R",
      "brand": "혼다",
      "model": "CBR650R",
      "displacement": 649,
      "category": "스포츠",
      "electric": false,
      "fuelGrade": "regular",
      "seatHeight": 810,
      "weight": 208,
      "cylinders": 4,
      "cooling": "liquid",
      "fuelCapacity": 15.4,
      "power": 95,
      "emissionStandard": "euro5",
      "status": "verified",
      "aliases": ["CBR650RA", "CBR650RAC"],
      "firstCertifiedAt": "2018-12-12",
      "lastCertifiedAt": "2024-04-12",
      "certifications": [
        {
          "no": "JMC-HK-8",
          "date": "2018-12-12",
          "office": "혼다코리아(주)",
          "vehNm": "CBR650RA",
          "vehType": "RH01",
          "fuel": "휘발유(Gasoline)",
          "gubun": "import"
        }
        // 같은 모델에 연결된 다른 인증 이력이 이어집니다
      ]
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `nameKo` | 한글 통용 표기. 브랜드 + 모델명 |
| `brand` / `model` | 브랜드명 / 모델명 |
| `displacement` | 실배기량(cc). 전기는 null |
| `category` | 스포츠/네이키드/크루저/투어러/어드벤처/스쿠터/언더본/오프로드/클래식/미니/3륜/4륜 |
| `electric` | 전기 구동 여부 |
| `fuelGrade` | `regular`(일반유) / `premium`(고급유 권장). 제조사 매뉴얼 기준 |
| `seatHeight` / `weight` | 시트고(mm), 중량(kg) |
| `cylinders` / `cooling` | 기통수, 냉각(`air`/`liquid`/`oil`) |
| `fuelCapacity` / `power` | 연료탱크(L), 최고출력(PS) |
| `emissionStandard` | `euro3`/`euro4`/`euro5`. 최신 인증의 배출허용기준 등을 바탕으로 분류 |
| `status` | `verified`: 인증 이력이 연결됨 / `curated`: 별도 자료로 정리했으며 인증 이력은 연결되지 않음 |
| `aliases` | 같은 기종으로 연결하는 차명·코드 표기 |
| `firstCertifiedAt` / `lastCertifiedAt` | 최초·최근 인증일. 출시일이나 판매 종료일과는 다름 |
| `certifications[].no` | 인증번호 |
| `certifications[].office` | 인증을 받은 업체명 |
| `certifications[].vehNm` / `vehType` | 인증 차명과 형식 |
| `certifications[].gubun` | `import`(수입제작차) / `domestic`(국내제작차) |

### 미매핑 목록 (unmapped.json)

[unmapped.json](https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/unmapped.json)은 인증 차명 중 모델을 확정하지 못했거나 매핑 대상에서 제외한 항목을 담습니다. API 엔드포인트가 아닌 정적 파일입니다. 아래는 각 목록의 형식 예시이며 현재 목록과는 다를 수 있습니다.

```jsonc
{
  "unmapped": [
    { "vehNm": "마이크로레이서", "office": "(주)라라클래식모터스", "brandHint": null, "count": 2, "lastDate": "2026-07-09" }
  ],
  // 후보 모델이 여러 개여서 확정하지 못한 항목
  "ambiguous": [
    { "vehNm": "엑시브", "office": "케이알모터스(주)", "candidates": ["KR모터스 엑시브250N", "KR모터스 엑시브250R"], "count": 2, "lastDate": "2014-08-27" }
  ],
  // 자리표시자·시험 등록 등 매핑 대상에서 제외한 항목
  "excluded": [
    { "vehNm": "동일차_1", "office": "디에스글로벌", "count": 2, "lastDate": "2019-03-04", "reason": "KENCIS 자리표시자" }
  ]
}
```

CI는 원본 인증 행 수가 모델에 연결된 인증 수와 `unmapped`·`ambiguous`·`excluded`의 `count` 합계를 더한 값과 일치하는지 검사합니다.

## 데이터 출처와 범위

[공공데이터포털의 KENCIS 배출가스·소음 인증 데이터](https://www.data.go.kr/data/15000988/openapi.do)를 수집합니다. 인증 차명은 판매명과 다를 수 있습니다. 예를 들어 골드윙은 `GL1800`, 하야부사는 `GSX1300BKA` 같은 코드로 등록돼 있습니다. `mapping/`에서 이런 표기를 모델명과 연결하고, 여러 인증 이력을 모델 단위로 묶습니다.

- 현재 수집 범위는 2006년 이후 인증 자료입니다. 이전 기종이나 API에서 조회되지 않는 기종은 별도 자료를 확인해 추가합니다.
- 인증 목록에는 병행수입 차량과 실제 판매 여부를 확인하지 못한 차량도 포함됩니다. 국내 정식 판매 기종을 빠짐없이 수록한 목록은 아닙니다.
- `verified`는 인증 이력이 연결됐다는 뜻입니다. 모든 제원이 검증됐거나 현재 판매 중임을 뜻하지는 않습니다.
- 제원을 확인하지 못한 필드는 `null`로 둡니다. 연식·트림별 차이가 있으므로 개별 차량의 사양과 다를 수 있습니다.

## 데이터 갱신

GitHub Actions가 매주 월요일 13:17 KST에 인증 수집을 시도합니다. 실패하면 16:17, 19:17에 다시 시도하며, 수집·검증·PR 게시까지 성공한 날에는 나머지 예약 실행을 건너뜁니다.

새로 생기거나 변경된 미매핑 항목은 AI가 자료를 조사해 매핑을 제안합니다. 고신뢰 제안 중 검증을 통과한 것만 반영해 PR을 만들고, 별도의 AI 검토가 해당 PR의 커밋을 확인해 `이대로 머지 가능` 또는 `추가 조치 필요` 코멘트를 남깁니다. 머지는 사람이 결정합니다.

AI 조사에 실패하면 매핑 보완 없이 원본 동기화 PR을 게시합니다. 사후 검토를 완료하지 못한 경우에는 수동 확인 안내를 남깁니다. 이때 원본을 다시 수집하지는 않습니다.

### 동기화 설정

- 기본 AI 모델은 `gpt-6-astra`이며 저장소 변수 `CODEX_SYNC_MODEL`로 변경할 수 있습니다. `OPENAI_API_KEY`가 속한 프로젝트에서도 해당 모델이 허용돼 있어야 합니다. 모델 접근 권한으로 인한 403 오류가 나면 이 설정을 확인하세요.
- 웹 자료는 별도 Responses API `web_search` 단계에서 수집합니다. 사전 보완과 사후 검토는 각각 자료를 조사하며, Codex는 출처와 대상 커밋 SHA를 담은 `sync-evidence.json`을 읽습니다. Codex의 파일 쓰기·네트워크 접근은 차단하고, 원본 API 키는 PR 코드에 전달하지 않습니다.
- 웹 수집은 단계당 대상 20개, 초기 입력 60,000자, API 요청 1회, 검색 도구 호출 12회, 출력 8,000토큰(추론 포함), 8분으로 제한합니다. 대상이 없으면 호출하지 않으며, 제한 초과·검색 실패·자료 누락 시 자동 확정을 보류합니다.
- 검색 결과의 입력 토큰과 후속 Codex 검토 사용량은 위 입력·출력 상한과 별개입니다. 웹 수집 사용량과 근거는 실행 요약·artifact에 남기며, 근거 artifact는 7일간 보관합니다.

매핑이나 권한 설정을 수정한 뒤에는 Actions의 `sync-kencis`에서 `review-only`를 켜서 실행하세요. 원본을 재수집하거나 기존 보완 커밋을 덮어쓰지 않고, 열린 `sync/kencis → main` PR의 최신 커밋만 검토합니다. 머지 전에는 코멘트에 적힌 SHA가 현재 PR의 최신 커밋과 같은지 확인하세요.

## 개발과 기여

```bash
DATA_GO_KR_KEY='공공데이터포털 인증키' npm run fetch   # 인증 전량 재수집
# KENCIS가 실제로 행을 삭제한 것이 확인된 경우에만 ALLOW_KENCIS_SHRINK=1 추가
npm run build      # 모델 데이터와 미매핑 목록 생성
npm run validate   # 데이터 형식·인증 건수·매핑 정합성 검사
npm test           # API·빌드·동기화 로직 테스트
npm run check      # 빌드, 정합성 검사, 테스트 실행
```

잘못된 모델명·제원이나 미매핑 항목을 찾았다면 출처와 함께 이슈 또는 PR로 알려주세요. 매핑은 `mapping/models.json`에서 수정하고, `npm run build`로 갱신한 `data/` 파일도 함께 커밋합니다.

## 라이선스

- 코드: [MIT](LICENSE)
- 인증 원본(`data/raw/`): [공공데이터포털 15000988](https://www.data.go.kr/data/15000988/openapi.do) (환경부·국립환경과학원)
- 매핑·정제 데이터: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ko). 사용 시 출처를 moto-kr로 표기해 주세요.
