# 🏍️ moto-kr

> 한국 정발 오토바이 기종 오픈소스 API

국내에 어떤 오토바이가 정식 발매됐는지 조회할 API가 없었습니다. 공공 데이터는 등록 대수 통계 아니면 개별 차량 조회만 가능하였습니다. moto-kr가 그 빈자리를 채웁니다.

## 🚀 API

베이스 URL은 `https://moto-kr.starhn87.workers.dev`입니다. 키 없이 호출하고 CORS가 열려 있으며 응답은 엣지 캐시를 탑니다.

```
GET /models                                  # 전체 덤프 (인증 이력 포함)
GET /models?category=크루저&ccMin=800         # 필터 조회 (요약 스키마)
GET /brands                                  # 브랜드 목록과 기종 수
GET /meta                                    # 데이터 생성일과 집계
```

파라미터 없이 `/models`를 호출하면 인증 이력까지 담긴 전체 데이터를 반환합니다.

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
| `seatHeightMin/Max`, `weightMin/Max`, `fuelCapacityMin/Max`, `powerMin/Max` | 수치 범위 |
| `electric`, `status`, `q`, `limit`, `offset` | 전기 여부, 검증 상태, 검색어, 페이징 |

원동기 면허(125cc 이하) 기종은 `ccMax=125`로 필터링할 수 있습니다.

정적 파일을 직접 쓰고 싶다면 CDN 경로도 있습니다: `https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/` 아래에 `models.json`(전문), `models.lite.json`(요약), `models.min.json`(이름 배열), `unmapped.json`(매핑이 완료되지 않은 대상 <- 기여 가능)이 있습니다.

### 응답 예시 (models.json)

```jsonc
{
  "meta": {
    "generatedAt": "2026-07-17",
    "source": "KENCIS 자동차 배출가스·소음 인증 (data.go.kr 15000988)",
    "counts": { "models": 808, "verified": 534, "curated": 274, "certifications": 5605, "unmapped": 738 }
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
        // 연식 변경마다 인증이 추가됩니다
      ]
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `nameKo` | 한글 통용 표기. 브랜드 + 모델명 |
| `brand` / `model` | 표기를 나눠 쓸 때 사용 |
| `displacement` | 실배기량(cc). 전기는 null |
| `category` | 스포츠/네이키드/크루저/투어러/어드벤처/스쿠터/언더본/오프로드/클래식/미니/3륜 |
| `electric` | 전기 구동 여부 |
| `fuelGrade` | `regular`(일반유) / `premium`(고급유 권장). 제조사 매뉴얼 기준 |
| `seatHeight` / `weight` | 시트고(mm), 중량(kg, 습중량 기준) |
| `cylinders` / `cooling` | 기통수, 냉각(`air`/`liquid`/`oil`) |
| `fuelCapacity` / `power` | 연료탱크(L), 최고출력(PS) |
| `emissionStandard` | `euro3`/`euro4`/`euro5`. 최신 인증의 배출허용기준에서 유도 |
| `status` | `verified`: 인증 이력이 연결됨 / `curated`: 웹 리서치 근거만 있음 |
| `aliases` | 이 기종으로 매핑된 인증 차명들. 형식코드 포함 |
| `firstCertifiedAt` / `lastCertifiedAt` | 최초·최근 인증일. 판매 시기를 가늠할 수 있습니다 |
| `certifications[].no` | 인증번호 |
| `certifications[].office` | 인증받은 업체. 공식 수입원인지 병행수입사인지 여기서 드러납니다 |
| `certifications[].vehNm` / `vehType` | 인증 차명과 형식 |
| `certifications[].gubun` | `import`(수입제작차) / `domestic`(국내제작차) |

### GET /data/unmapped.json

인증은 존재하지만 아직 소비자 모델명으로 연결되지 않은 차명 목록입니다. 기여가 필요한 지점입니다.

```jsonc
{
  "unmapped": [
    { "vehNm": "마이크로레이서", "office": "(주)라라클래식모터스", "brandHint": null, "count": 2, "lastDate": "2026-07-09" }
  ]
}
```

### 알아둘 것

- `@main`은 jsDelivr 캐시 때문에 갱신이 최대 12시간 늦을 수 있습니다. 버전을 고정하려면 `@main` 대신 커밋 해시나 태그를 쓰세요
- 원하는 필드만 필요하면 응답을 받아 직접 필터 처리하면 됩니다. 서버가 없는 대신 전체 응답이 수백 KB 수준이라 부담이 없습니다

## 🧩 어떻게 만들었나

환경부 KENCIS [배출가스·소음 인증](https://www.data.go.kr/data/15000988/openapi.do) 공공 데이터가 원천입니다. 국내에서 이륜차를 판매하려면 이 인증이 법정 의무라 인증 목록(2006~)이 곧 정발 기종의 공식 전수 목록입니다.

다만 인증 데이터를 그대로 쓸 수는 없습니다. 골드윙이 `GL1800`으로, 하야부사가 `GSX1300BKA`로 올라가 있고 연식마다 행이 중복되며 병행수입 인증도 섞여 있습니다. 그래서 `mapping/`에서 인증 차명을 소비자 모델명과 한글 통용 표기로 하나하나 연결합니다.

갱신은 자동입니다. GitHub Actions가 매주 인증 데이터를 다시 수집하고 새 인증이 나타나면 PR을 만듭니다. 표기만 확정해 머지하면 API에 반영됩니다.

## 📏 커버리지와 한계

- KENCIS 인증은 2006년부터입니다. 그 이전 레트로 기종은 커뮤니티 기여 영역으로 남아 있습니다
- 일부 브랜드(로얄엔필드, 인디언, CFMOTO 등)는 정발 판매 중인데도 이 API에서 인증이 조회되지 않습니다. 이런 기종은 웹 리서치 근거로 `curated` 상태를 유지합니다

## 🛠️ 개발

```bash
DATA_GO_KR_KEY=<공공데이터포털 인증키> npm run fetch   # 인증 전량 재수집
npm run build      # data/models*.json 산출
npm run validate   # 무결성 검증
```

## 📜 출처와 라이선스

- 코드: MIT
- 인증 원본(`data/raw/`): [공공데이터포털 15000988](https://www.data.go.kr/data/15000988/openapi.do) (환경부·국립환경과학원)
- 매핑·정제 데이터: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ko), 출처(moto-kr)를 밝히고 자유롭게 쓸 수 있습니다

