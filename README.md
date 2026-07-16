# moto-kr

한국 정발(정식 발매) 오토바이 기종 데이터셋.

국내에는 이륜차 기종 카탈로그를 구조화 데이터로 제공하는 곳이 없다. 공공 데이터는 등록 대수 통계 아니면 개별 차량 조회뿐이고, 민간 DB는 API 를 열지 않는다. moto-kr 는 그 공백을 채운다:

- **골격**: 환경부 KENCIS [자동차 배출가스·소음 인증 오픈API](https://www.data.go.kr/data/15000988/openapi.do). 국내 판매용 이륜차는 인증이 법정 의무라, 인증 목록(2006~)이 정발 기종의 공식 전수에 가장 가깝다.
- **정제**: 인증 데이터는 형식코드 표기(`GL1800`, `GSX1300BKA`), 연식별 중복, 병행수입 혼재 탓에 그대로 쓸 수 없다. 사람이 관리하는 매핑(`mapping/`)이 이를 소비자 모델명·한글 통용 표기로 정리한다.
- **갱신**: GitHub Actions 가 매주 인증 데이터를 다시 수집하고, 새 인증이 나타나면 PR 을 만든다. 표기만 확정해 머지하면 데이터셋에 반영된다.

## 사용

빌드 산출물을 CDN 으로 바로 소비할 수 있다:

```
https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/models.min.json   # 자동완성용 한글 표기 배열
https://cdn.jsdelivr.net/gh/starhn87/moto-kr@main/data/models.json       # 풀 스키마 (인증 이력 포함)
```

### models.json 스키마

```jsonc
{
  "nameKo": "혼다 CBR650R",        // 한글 통용 표기 (브랜드 + 모델)
  "brand": "혼다",
  "model": "CBR650R",
  "status": "verified",            // verified: KENCIS 인증 연결됨 | curated: 리서치 근거만
  "aliases": ["CBR650RA"],         // 매칭된 인증 차명들
  "firstCertifiedAt": "2019-03-05",
  "lastCertifiedAt": "2023-01-10",
  "certifications": [ /* 인증번호·일자·업체·형식 원본 */ ]
}
```

## 커버리지와 한계

- **시간**: KENCIS 인증은 2006년부터다. 그 이전(레트로) 기종은 커뮤니티 기여 영역으로 남아 있다.
- **브랜드 갭**: 일부 브랜드(로얄엔필드·인디언·CFMOTO 등)는 정발 판매 중임에도 이 API 에서 인증이 조회되지 않는다(수입원 법인·대행 관계로 추정). 이런 기종은 웹 리서치 근거로 `curated` 상태를 유지한다.
- **`data/unmapped.json`**: 인증은 존재하지만 아직 소비자 모델명으로 매핑되지 않은 차명 목록. 기여하기 가장 좋은 지점이다.

## 데이터 출처와 라이선스

- 코드: MIT
- 인증 원본(`data/raw/`): [공공데이터포털 15000988](https://www.data.go.kr/data/15000988/openapi.do) (환경부·국립환경과학원)
- 매핑·정제 데이터: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ko) — 출처(moto-kr)를 밝히고 자유롭게 사용

## 개발

```bash
DATA_GO_KR_KEY=<공공데이터포털 인증키> npm run fetch   # 인증 전량 재수집
npm run build      # data/models*.json 산출
npm run validate   # 무결성 검증
```

이 데이터셋은 오토바이 라이더용 지도 앱 [모토맵](https://github.com/starhn87/ridemap)의 기종 자동완성을 위해 시작됐다.
