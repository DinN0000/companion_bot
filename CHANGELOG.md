# Changelog

All notable changes to CompanionBot will be documented in this file.

## [0.15.2] - 2025-02-09

### 🔒 보안 강화 (OpenClaw 스타일)
- **파일 접근 제한**: 홈 전체 → workspace (~/.companionbot) + /tmp만
- **TOCTOU 방어**: O_NOFOLLOW + inode/device 비교
- **safeOpenForRead**: 안전한 파일 읽기 함수 추가

## [0.15.0] - 2025-02-09

### 🧠 메모리 검색 개선
- **도구 방식**: 매 메시지 자동 검색 → AI가 필요 시 `memory_search` 호출
- **성능 향상**: 불필요한 벡터 검색 제거

### 📦 코드 구조 개선
- **tools 분할**: 1973줄 단일 파일 → 15개 모듈
  - file.ts, web.ts, schedule.ts, session.ts
  - memory.ts, agent.ts, weather.ts, model.ts

### 🔒 안정성
- **Agent 누수 방지**: 최대 10개 (chatId당 3개), TTL 30분

### 📱 UX 개선
- **/help 명령어**: 기능별 분류, 자연어 예시
- **setMyCommands**: 주요 명령어 등록
- **한국어 통일**: 에러 메시지, /model 응답

## [0.14.0] - 2025-02-09

### 🧠 Thinking 개선
- **내부 스트리밍**: thinking 활성화 가능
- **도구 사용 시**: 자동으로 thinking off (API 에러 방지)

## [0.13.0] - 2025-02-09

### 단순화
- **스트리밍 제거**: 최종 응답만 한 번에 전송
- **thinking 수정**: non-streaming에서 에러 발생하여 임시 비활성화

## [0.12.0] - 2025-02-09

### 💬 상태 피드백 개선
- **Typing 자동 갱신**: 4초마다 갱신하여 긴 작업 중에도 표시 유지
- **친화적 도구 상태**: `web_search` → `🔍 웹에서 검색하는 중...`
- **진행 단계 표시**: 생각 중 → 도구 사용 → 응답 작성 단계 표시
- **예상 시간 안내**: 도구별 예상 대기 시간 표시 (약 5-10초)
- **긴 작업 피드백**: 5초 경과 시 `⏳ 7초 경과... 조금만 기다려줘!`

### 📝 문서화
- `docs/status-feedback.md` - 상태 피드백 시스템 문서

## [0.8.0] - 2025-02-09

### ✨ Setup Wizard 개선
- 인터랙티브 체크박스로 기능 선택
- 단계별 상세 가이드 (BotFather, Anthropic 설정 방법)
- `Ctrl+C`로 언제든 취소 가능
- `● 다음 단계로` - Enter로 건너뛰기

## [0.7.0] - 2025-02-09

### 🔧 품질 개선 (10-point review)
- **타입 안전성**: strict 모드 통과, any → unknown
- **보안**: IPv6 SSRF 차단
- **성능**: 배치 임베딩, 병렬 처리, 캐싱
- **번들 크기**: googleapis → @googleapis/calendar (200MB 절감)
- **엣지케이스**: null/undefined 핸들링
- **상수화**: 매직 넘버 → constants.ts

## [0.6.0] - 2025-02-09

### 🚀 주요 기능 추가
- **스트리밍**: 실시간 응답 표시 (타이핑 효과)
- **행동 지침**: Tool Call Style, Silent Replies, Reactions
- **자동 Compaction**: 토큰 60% 초과 시 자동 요약
- **Rate Limit 관리**: 429 에러 시 자동 재시도
- **Health Check**: `/health` 명령어
- **업데이트 체크**: 하루 1회 npm 버전 확인

## [0.5.0] - 2025-02-08

### 🧠 메모리 시스템
- **시맨틱 검색**: 로컬 임베딩 (multilingual-e5-small)
- **자동 인덱싱**: MEMORY.md + 최근 30일 일일 메모리
- **memory_search**: 기억 검색 도구
- **memory_reindex**: 수동 리인덱싱

### 🎯 AI 개선
- **Extended Thinking**: 모델별 thinking budget
- **토큰 기반 히스토리**: 50k 한도 (20 메시지 → 토큰 기반)
- **한국어 토큰 추정**: 1.5 토큰/글자

## [0.4.0] - 2025-02-07

### 📅 일정 관리
- Google Calendar 연동
- 리마인더 기능
- 아침 브리핑

## [0.3.0] - 2025-02-06

### 🤖 기본 기능
- Telegram 봇 연동
- Claude AI 대화
- 파일 읽기/쓰기
- 웹 검색 (Brave API)
- 워크스페이스 시스템

---

[0.8.0]: https://github.com/DinN0000/CompanionBot/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/DinN0000/CompanionBot/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/DinN0000/CompanionBot/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DinN0000/CompanionBot/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DinN0000/CompanionBot/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DinN0000/CompanionBot/releases/tag/v0.3.0
