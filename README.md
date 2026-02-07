# CompanionBot

Claude 기반의 개인화된 페르소나를 가진 AI Companion Bot

## 기능

- 자연스러운 대화 (Claude Sonnet/Opus/Haiku)
- 첫 실행 시 온보딩으로 페르소나 설정
- 이미지 분석 (사진 보내면 분석)
- 링크 요약 (URL 보내면 내용 요약)
- 날씨 조회 ("서울 날씨 어때?")
- 리마인더 ("10분 뒤에 알려줘")
- Google Calendar 연동
- 일일 브리핑 (매일 아침 날씨/일정)
- Heartbeat (주기적 체크 후 알림)
- 일일 메모리 자동 저장

## 설치

### 간편 설치 (일반 사용자)

```bash
npm install -g companionbot
companionbot
```

첫 실행 시 자동으로 설정을 안내합니다.

### 개발자 설치 (소스코드 수정)

```bash
git clone https://github.com/DinN0000/CompanionBot.git
cd companionbot
npm install
npm run build
npm start
```

### 사전 준비

- **Node.js 18+**
- **Telegram Bot Token** - @BotFather에서 발급
- **Anthropic API Key** - console.anthropic.com

#### Linux 사용자 (keytar 의존성)

```bash
# Debian/Ubuntu
sudo apt-get install libsecret-1-dev

# Fedora
sudo dnf install libsecret-devel

# Arch
sudo pacman -S libsecret
```

## 첫 실행

```
🤖 CompanionBot 첫 실행입니다!

[1/2] Telegram Bot Token
      @BotFather에서 봇 생성 후 토큰을 붙여넣으세요.
      Token: _

[2/2] Anthropic API Key
      console.anthropic.com에서 발급받으세요.
      API Key: _

📁 워크스페이스 생성 중...
   → ~/.companionbot/ 생성 완료

🚀 봇을 시작합니다!
```

## 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 봇 시작 (첫 실행 시 온보딩) |
| `/setup` | 기능 설정 메뉴 |
| `/briefing` | 일일 브리핑 토글 |
| `/heartbeat` | Heartbeat 토글 |
| `/reminders` | 알림 목록 |
| `/calendar` | 오늘 일정 |
| `/compact` | 대화 정리 |
| `/memory` | 최근 기억 |
| `/reset` | 페르소나 초기화 |

### 자연어 명령

명령어 대신 자연어로 말해도 됩니다:

- "하이쿠로 바꿔줘" → 모델 변경
- "10분 뒤에 알려줘" → 리마인더
- "브리핑 꺼줘" → 브리핑 비활성화
- "아침 9시에 브리핑 해줘" → 브리핑 시간 설정
- "지금 브리핑 해줘" → 즉시 브리핑
- "하트비트 켜줘" → Heartbeat 활성화
- "서울 날씨 어때?" → 날씨 조회
- "이거 기억해둬" → 메모리 저장

## PM2로 상시 실행

```bash
npm install -g pm2
pm2 start npm --name companionbot -- start
pm2 startup && pm2 save
```

## 워크스페이스

`~/.companionbot/` 구조:

```
├── AGENTS.md      # 운영 지침
├── BOOTSTRAP.md   # 온보딩 (완료 후 삭제)
├── HEARTBEAT.md   # 주기적 체크 항목
├── IDENTITY.md    # 봇 정체성
├── MEMORY.md      # 장기 기억
├── SOUL.md        # 봇 성격
├── TOOLS.md       # 도구 설정
├── USER.md        # 사용자 정보
├── canvas/        # 봇 작업 디렉토리
└── memory/        # 일일 로그
    └── YYYY-MM-DD.md
```

## 시크릿 저장

OS 키체인에 안전하게 저장됩니다:
- macOS: Keychain Access
- Windows: Credential Manager
- Linux: libsecret

재설정: `~/.companionbot/` 삭제 후 다시 실행

## 개발

```bash
npm run dev    # 개발 모드
npm run build  # 빌드
npm start      # 실행
```

## License

MIT
