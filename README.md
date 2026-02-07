# CompanionBot

AI 친구 텔레그램 봇. Claude API 기반으로 개인화된 페르소나를 가진 대화 상대.

## 기능

- 자연스러운 대화 (Claude Sonnet/Opus/Haiku)
- 첫 실행 시 온보딩으로 페르소나 설정
- 이미지 분석 (사진 보내면 분석)
- 링크 요약 (URL 보내면 내용 요약)
- 일일 메모리 자동 저장
- PM2로 항상 실행

## 설치

### 1. 사전 준비

- Node.js 18+
- Telegram Bot Token (@BotFather에서 발급)
- Anthropic API Key (console.anthropic.com)

### 2. 클론 및 설치

```bash
git clone https://github.com/YOUR_USERNAME/companionbot.git
cd companionbot
npm install
npm run build
```

### 3. 첫 실행

```bash
npm start
```

첫 실행 시 인터랙티브하게 설정을 진행합니다:

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

### 4. PM2로 상시 실행 (선택)

```bash
# PM2 설치
npm install -g pm2

# 봇 등록 및 시작
pm2 start npm --name companionbot -- start

# 상태 확인
pm2 status

# 로그 보기
pm2 logs companionbot

# 재시작
pm2 restart companionbot

# 중지
pm2 stop companionbot
```

시스템 재부팅 후 자동 시작:
```bash
pm2 startup
pm2 save
```

## 사용법

### 텔레그램 명령어

- `/start` - 봇 시작 (첫 실행 시 온보딩)
- `/compact` - 대화 히스토리 정리
- `/memory` - 최근 기억 보기
- `/model` - AI 모델 변경
- `/reset` - 페르소나 초기화

### 자연어 기능

- 사진 보내기 → 이미지 분석
- URL 보내기 → 링크 내용 요약
- "opus로 바꿔줘" → 모델 변경
- "이거 기억해둬" → 메모리 저장

## 프로젝트 구조

```
companionbot/
├── src/
│   ├── cli/
│   │   └── main.ts        # CLI 진입점
│   ├── telegram/
│   │   └── bot.ts         # 텔레그램 봇 핸들러
│   ├── ai/
│   │   └── claude.ts      # Claude API 통신
│   ├── workspace/
│   │   ├── paths.ts       # 경로 상수
│   │   ├── init.ts        # 워크스페이스 초기화
│   │   ├── load.ts        # 파일 로드/저장
│   │   └── index.ts       # 통합 export
│   ├── tools/
│   │   └── index.ts       # AI 도구 정의
│   ├── session/
│   │   └── state.ts       # 세션 상태 관리
│   └── config/
│       └── secrets.ts     # 시크릿 관리 (keychain)
├── templates/             # 워크스페이스 템플릿
│   ├── BOOTSTRAP.md       # 온보딩 프롬프트
│   ├── IDENTITY.md        # 봇 정체성
│   ├── SOUL.md            # 봇 성격
│   ├── USER.md            # 사용자 정보
│   ├── AGENTS.md          # 운영 지침
│   └── MEMORY.md          # 장기 기억
├── bin/
│   └── companionbot.js    # npm global 진입점
├── dist/                  # 빌드 결과물
└── package.json
```

## 워크스페이스

`~/.companionbot/` 에 저장되는 파일들:

| 파일 | 설명 |
|------|------|
| `IDENTITY.md` | 봇 이름, 이모지, 바이브 |
| `SOUL.md` | 성격, 말투, 철학 |
| `USER.md` | 사용자 정보 |
| `AGENTS.md` | 운영 지침 |
| `MEMORY.md` | 장기 기억 |
| `memory/YYYY-MM-DD.md` | 일일 기억 |

## 개발

```bash
# 개발 모드 (hot reload)
npm run dev

# 빌드
npm run build

# 빌드 후 실행
npm start
```

## 시크릿 저장 위치

OS 키체인에 저장됩니다:
- macOS: Keychain Access
- Windows: Credential Manager
- Linux: libsecret

수동으로 재설정하려면 `~/.companionbot/` 삭제 후 다시 실행하세요.

## License

MIT
