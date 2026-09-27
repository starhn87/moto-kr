# Jev 매핑 관찰

moto-kr의 공개 정적 API는 AI를 호출하지 않는다. Jev는 주간 동기화의 구조화된
매핑 제안을 관찰하는 별도 읽기 전용 Node 도구다. 기존 웹 조사, Codex의 제안,
PR HEAD에 대한 독립 검토와 사람의 최종 머지 판단을 유지한다.

## 공통 패키지

`@starhn87/jev-decisions@0.3.0`의 응답 유틸리티 artifact를 `vendor/jev-decisions`에
고정했다. CI는 이 저장소만 checkout한 후 `npm ci`로 설치할 수 있다. 원본은
jev-utils의 `packages/decisions`이며 `provenance.json`에 원본 커밋과
각 파일의 SHA-256을 기록한다. 원본의 vendor 스크립트로 갱신하고 수동 편집하지 않는다.

## 근거와 실제 반영의 경계

`apply-ai-mappings.mjs <candidates> <proposal> <report> <evidence>`는 제안의 스키마와
동기화 후보를 검증한 후 같은 HEAD의 완료된 enrichment 근거를 요구한다. 근거의
입력 해시는 현재 후보와 원본 인증으로 다시 계산하며, 각 제안의 출처는 **해당 후보**의
실제 수집된 URL에 포함돼야 한다. 고신뢰 자동 반영에는 supported 근거가 필요하다.
불일치·충돌·자료 누락은 기존 raw-sync fallback으로 돌아간다. 이 검증은 Jev 설정과
관계없이 적용되는 결정론적 계약이며, URL 연결만으로 의미 정확도를 증명하지는 않는다.

동일 업체·인증 차명·형식코드의 재발급이나 날짜·상태·배출 기준만 바뀐 경우에는 외부
웹 조사를 반복하지 않는다. 새로운 연결·모델·제원·별칭과 미해결 후보는 계속 조사한다.
원본 인증과 파생 데이터의 정합성은 기존 build/validate 및 독립 리뷰가 확인한다.

## Shadow 실행

GitHub `JEV_MAPPING_MODE=shadow` 변수와 `TYPESAFE_API_KEY` secret을 설정하면
`jev-audit` 잡이 관찰을 실행한다. 기본은 off이며 enforce는 지원하지 않는다.
이 잡은 쓰기 토큰을 받지 않고 publish가 기다리지도 않는다. 기존 Codex Action은
enrich 잡의 마지막 단계로 유지하고, publish 잡에서 공급자를 호출하지 않는다.

Jev `jev-1.13.0`, 질문 `kencis-mapping-link` 버전 1로 직접 코드 연결·기본 플랫폼만
확인·충돌·근거 부족을 분류한다. 후보 최대 20개, 전체 입력 60,000자, 순차 실행,
요청당 2초 deadline, 재시도 0이다. 요청 전 동일 HEAD·후보·근거·제안을 검증한다.
`jev-mapping-audit` artifact에는 분포·질문/모델 버전·지연·사용량·후보 ID·제안 해시·
run ID·evidence 입력 해시를 남긴다. 키·조사 원문은 남기지 않는다. 누락된 사용량은
0으로 계산하지 않는다. 관찰 실패도 제안을 승인하거나 차단하지 않는다.

현재 검증은 모의 전송·실패·출처 계약과 기존 데이터 정합성이다. 한국어 의미 정확도나
실제 비용 절감을 확인한 상태가 아니다. 과거 사례의 직접 코드·시장 접미사·세대·트림
오병합을 사람이 검토한 뒤 shadow 분포와 비교해야 한다. 그 전에는 자동 반영이나
독립 리뷰 대체에 Jev 결과를 사용하지 않는다.

2026-09-27부터 저장소 변수는 shadow로 설정했다. 신규/변경 후보가 있는 동기화 실행에서만 측정하며, 감사 artifact를 30일 보관한다. 공통 저장소의 주간 이슈가 관측 결과와 수집 공백을 추적한다.

호출은 공식 `@typesafe-ai/sdk@0.6.0`의 `TypeSafeClient.systemOne()`으로 수행하고,
공통 `observe`에 SDK 실행 함수를 전달해 시간 측정·응답 검증·오류 분류를 처리한다.
검증 실패는 관찰 artifact의 `result.error.issues`에 경로·코드로 남는다. 질문·예산·2초
timeout·재시도 0·Shadow 기록은 이 저장소가 소유한다. 기존 매핑과 공개 API 동작은 유지한다.
