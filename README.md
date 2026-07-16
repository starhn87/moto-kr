# 🏍️ moto-kr

> 한국 정발 오토바이 기종 데이터셋

[![CI](https://img.shields.io/github/actions/workflow/status/starhn87/moto-kr/ci.yml?style=flat-square&label=CI)](https://github.com/starhn87/moto-kr/actions)
![Models](https://img.shields.io/badge/models-808-blue?style=flat-square)
![Source](https://img.shields.io/badge/source-KENCIS_%EC%9D%B8%EC%A6%9D-green?style=flat-square)
![Code](https://img.shields.io/badge/code-MIT-lightgrey?style=flat-square)
![Data](https://img.shields.io/badge/data-CC_BY_4.0-lightgrey?style=flat-square)

국내에 어떤 오토바이가 정식 발매됐는지 정리된 데이터가 없습니다. 공공 데이터는 등록 대수 통계 아니면 개별 차량 조회뿐이고, 민간 DB는 API를 열지 않습니다. moto-kr는 그 빈자리를 채우는 데이터셋입니다.

## 🧩 어떻게 만드나

| 층 | 내용 |
|---|---|
| 골격 | 환경부 KENCIS [배출가스·소음 인증 오픈API](https://www.data.go.kr/data/15000988/openapi.do). 국내 판매용 이륜차는 인증이 법정 의무라, 인증 목록(2006~)이 정발 기종의 공식 전수에 가장 가깝습니다 |
| 정제 | 인증 데이터는 그대로 쓸 수 없습니다. 형식코드 표기(`GL1800`, `GSX1300BKA`), 연식별 중복, 병행수입 혼재를 사람이 관리하는 매핑(`mapping/`)으로 소비자 모델명과 한글 통용 표기로 정리합니다 |
| 갱신 | GitHub Actions가 매주 인증 데이터를 다시 수집하고, 새 인증이 나타나면 PR을 만듭니다. 표기만 확정해 머지하면 데이터셋에 반영됩니다 |

## 🚀 사용

빌드 산출물을 CDN으로 바로 가져다 쓸 수 있습니다.

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
  "status": "verified",            // verified: KENCIS 인증 연결됨 / curated: 리서치 근거만
  "aliases": ["CBR650RA"],         // 매칭된 인증 차명들
  "firstCertifiedAt": "2019-03-05",
  "lastCertifiedAt": "2023-01-10",
  "certifications": [ /* 인증번호, 일자, 업체, 형식 원본 */ ]
}
```

## 📏 커버리지와 한계

- **시간**: KENCIS 인증은 2006년부터입니다. 그 이전 레트로 기종은 커뮤니티 기여 영역으로 남아 있습니다
- **브랜드 갭**: 일부 브랜드(로얄엔필드, 인디언, CFMOTO 등)는 정발 판매 중인데도 이 API에서 인증이 조회되지 않습니다. 이런 기종은 웹 리서치 근거로 `curated` 상태를 유지합니다
- **`data/unmapped.json`**: 인증은 존재하지만 아직 소비자 모델명으로 매핑되지 않은 차명 목록입니다. 기여하기 가장 좋은 지점입니다

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

> 이 데이터셋은 오토바이 라이더용 지도 앱 [모토맵](https://github.com/starhn87/ridemap)의 기종 자동완성을 만들다 시작됐습니다.
