# CompanionBot

> Claude 기반 개인 AI 친구 - 텔레그램 봇

[![npm version](https://badge.fury.io/js/companionbot.svg)](https://www.npmjs.com/package/companionbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 특징

- 🧠 **Extended Thinking** - Claude의 사고 과정 활용
- 🔍 **시맨틱 메모리** - 로컬 임베딩으로 관련 기억 검색
- ⚡ **빠른 응답** - 사전 로딩, 병렬 처리, 스마트 캐싱
- 🎭 **페르소나** - 이름, 성격, 말투 커스터마이징
- 🔧 **20+ 도구** - 파일, 웹, 일정, 메모리 등

## 🚀 빠른 시작

```bash
npm install -g companionbot
companionbot
```

첫 실행 시 안내에 따라:
1. Telegram Bot Token 입력 ([@BotFather](https://t.me/BotFather))
2. Anthropic API Key 입력 ([console.anthropic.com](https://console.anthropic.com))
3. Telegram에서 봇에게 `/start` 보내기

## 🖥️ CLI 명령어

터미널에서 실행하는 명령어:

```bash
companionbot              # 봇 시작 (첫 실행 시 설정 마법사 자동 시작)
companionbot setup        # 설정 마법사 (전체)
companionbot setup telegram  # Telegram 토큰 설정
companionbot setup anthropic # Anthropic API 키 설정
companionbot setup weather   # 날씨 API 설정
companionbot setup calendar  # Google Calendar 연동
companionbot setup brave     # 웹 검색 API 설정
companionbot --help       # 도움말
companionbot --version    # 버전 확인
```

### 비대화형 모드

CI/CD나 스크립트에서 사용할 때:

```bash
companionbot -n           # --no-interactive 모드
```

환경변수로 설정 (비대화형 모드에서 사용):
- `TELEGRAM_BOT_TOKEN` - Telegram 봇 토큰
- `ANTHROPIC_API_KEY` - Anthropic API 키

## 📱 텔레그램 명령어

봇과 대화할 때 사용하는 명령어:

### 기본 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 봇 시작 |
| `/help` | 도움말 보기 |
| `/model` | AI 모델 변경 (haiku/sonnet/opus) |
| `/compact` | 대화 정리 (토큰 절약) |
| `/memory` | 최근 기억 보기 |
| `/health` | 봇 상태 확인 |
| `/reset` | 대화 초기화 |

### 고급 기능

| 명령어 | 설명 |
|--------|------|
| `/calendar_setup` | Google Calendar 연동 설정 |
| `/weather_setup` | 날씨 도시 설정 |
| `/briefing` | 브리핑 설정/실행 |
| `/reminders` | 리마인더 목록 보기 |
| `/heartbeat` | 하트비트 상태 확인 |

### 컨텍스트 관리

| 명령어 | 설명 |
|--------|------|
| `/pin <메시지>` | 메시지 고정 (항상 컨텍스트에 포함) |
| `/pins` | 고정된 메시지 목록 |
| `/unpin <번호>` | 고정 해제 |
| `/context` | 현재 컨텍스트 상태 확인 |

### 자연어로도 가능

```
"하이쿠로 바꿔줘"
"10분 뒤에 알려줘"
"서울 날씨 어때?"
"React 19 검색해줘"
"매일 아침 9시에 뉴스 알려줘"
```

## 🔧 주요 기능

### AI 엔진
- **Claude 모델** - Sonnet 4 / Opus 4 / Haiku 3.5
- **Extended Thinking** - 내부 스트리밍으로 thinking 지원
- **도구 사용** - 20+ 도구, 병렬 실행

### 메모리 시스템
- **로컬 임베딩** - @xenova/transformers
- **하이브리드 검색** - 벡터 + 키워드 (FTS5)
- **한국어 최적화** - trigram tokenizer

### 일정/알림
- **리마인더** - 자연어로 알림 설정
- **Google Calendar** - 일정 조회/추가
- **Cron** - 반복 작업 스케줄링
- **브리핑/하트비트** - 주기적 알림

### 성능
- **Warmup** - 시작 시 사전 로딩
- **병렬 처리** - 워크스페이스, 도구 실행
- **LRU 캐시** - 임베딩, 워크스페이스

## 📁 워크스페이스

`~/.companionbot/` 구조:

```
├── SOUL.md        # 봇 성격/말투
├── IDENTITY.md    # 이름, 이모지
├── USER.md        # 사용자 정보
├── MEMORY.md      # 장기 기억
├── AGENTS.md      # 행동 지침
├── HEARTBEAT.md   # 주기적 체크 항목
├── TOOLS.md       # 도구 설정
├── canvas/        # 작업 디렉토리
└── memory/        # 일일 로그
    └── YYYY-MM-DD.md
```

## ⚙️ 선택 기능

위 CLI 명령어로 설정:

- **날씨** - OpenWeatherMap API (`companionbot setup weather`)
- **일정** - Google Calendar 연동 (`companionbot setup calendar`)
- **검색** - Brave Search API (`companionbot setup brave`)

## 🖥️ PM2로 상시 실행

```bash
npm install -g pm2
pm2 start companionbot --name bot
pm2 startup && pm2 save
```

## 🔒 보안

- API 키는 OS 키체인에 저장 (macOS Keychain, Windows Credential Manager, Linux libsecret)
- 파일 접근 경로 검증 (TOCTOU 방지)
- 명령어 화이트리스트
- SSRF 방지

## 🐛 트러블슈팅

### 봇이 응답 안 해요
1. API 키 확인
2. `tail -f /tmp/companionbot.log` 로그 확인

### Linux 설치 오류
```bash
sudo apt-get install libsecret-1-dev  # Debian/Ubuntu
```

### 초기화하고 싶어요
```bash
rm -rf ~/.companionbot && companionbot
```

## 📜 버전

현재: **v0.15.2**

주요 변경:
- README 명령어 섹션 정리 (CLI/텔레그램 분리)
- 메모리 검색 → 도구 방식 (성능 개선)
- tools 모듈 분할 (15개 파일)
- Agent 메모리 누수 방지
- /help 명령어, 한국어 메시지 통일

전체 변경 이력: [CHANGELOG.md](CHANGELOG.md)

## 📄 라이선스

[MIT](LICENSE)

---

**Issues**: [github.com/DinN0000/CompanionBot/issues](https://github.com/DinN0000/CompanionBot/issues)
