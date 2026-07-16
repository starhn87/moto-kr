# 🏍️ moto-kr

> 한국 정발 오토바이 기종 오픈소스 API

국내에 어떤 오토바이가 정식 발매됐는지 조회할 API가 없습니다. 공공 데이터는 등록 대수 통계 아니면 개별 차량 조회뿐이고 민간 DB는 API를 열지 않습니다. moto-kr가 그 빈자리를 채웁니다. 키 발급도 호출 제한도 서버 다운타임도 없는 정적 JSON API입니다.

## 🚀 API

베이스 URL은 `https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main`입니다. CORS가 열려 있어 브라우저에서도 바로 호출할 수 있습니다.

### GET /data/models.min.json

자동완성처럼 이름 목록만 필요할 때 씁니다.

```js
const { names } = await fetch(
  'https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/models.min.json'
).then((r) => r.json());
```

```jsonc
{
  "meta": { "generatedAt": "2026-07-16", "models": 808 },
  "names": ["가와사키 W230", "가와사키 닌자 H2", "가와사키 닌자 H2 SX", /* ... */]
}
```

### GET /data/models.json

기종별 상세와 인증 이력까지 담긴 풀 데이터입니다.

```jsonc
{
  "meta": {
    "generatedAt": "2026-07-16",
    "source": "KENCIS 자동차 배출가스·소음 인증 (data.go.kr 15000988)",
    "counts": { "models": 808, "verified": 657, "curated": 151, "certifications": 5605, "unmapped": 96 }
  },
  "models": [
    {
      "nameKo": "혼다 CBR650R",
      "brand": "혼다",
      "model": "CBR650R",
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
| `status` | `verified`: 인증 이력이 연결됨 / `curated`: 웹 리서치 근거만 있음 |
| `aliases` | 이 기종으로 매핑된 인증 차명들. 형식코드 포함 |
| `firstCertifiedAt` / `lastCertifiedAt` | 최초·최근 인증일. 판매 시기를 가늠할 수 있습니다 |
| `certifications[].no` | 인증번호 |
| `certifications[].office` | 인증받은 업체. 공식 수입원인지 병행수입사인지 여기서 드러납니다 |
| `certifications[].vehNm` / `vehType` | 인증 차명과 형식 |
| `certifications[].gubun` | `import`(수입제작차) / `domestic`(국내제작차) |

### GET /data/unmapped.json

인증은 존재하지만 아직 소비자 모델명으로 연결되지 않은 차명 목록입니다. 기여하기 가장 좋은 지점입니다.

```jsonc
{
  "unmapped": [
    { "vehNm": "마이크로레이서", "office": "(주)라라클래식모터스", "brandHint": null, "count": 2, "lastDate": "2026-07-09" }
  ]
}
```

### 알아둘 것

- `@main`은 jsDelivr 캐시 때문에 갱신이 최대 12시간 늦을 수 있습니다. 버전을 고정하려면 `@main` 대신 커밋 해시나 태그를 쓰세요
- 원하는 필드만 필요하면 응답을 받아 직접 거르면 됩니다. 서버가 없는 대신 전체 응답이 수백 KB 수준이라 부담이 없습니다

## 🧩 어떻게 만들었나

환경부 KENCIS [배출가스·소음 인증](https://www.data.go.kr/data/15000988/openapi.do)에서 출발합니다. 국내에서 이륜차를 팔려면 이 인증이 법정 의무라 인증 목록(2006~)이 곧 정발 기종의 공식 전수 목록입니다.

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

