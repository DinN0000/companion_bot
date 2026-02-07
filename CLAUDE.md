# Claude Code Guide

이 문서는 Claude Code가 CompanionBot 프로젝트를 이해하고 도울 수 있도록 작성되었습니다.

## 프로젝트 개요

CompanionBot은 Telegram에서 동작하는 AI 친구 봇입니다. Claude API를 사용하여 개인화된 대화를 제공합니다.

## 핵심 아키텍처

```
사용자 (Telegram)
    ↓
grammY (Telegram Bot Framework)
    ↓
bot.ts (메시지 핸들러)
    ↓
claude.ts (Claude API + Tool Use)
    ↓
workspace/ (페르소나 & 메모리)
```

## 설치 도움

사용자가 설치를 요청하면:

### 1. 의존성 설치
```bash
npm install
```

### 2. 빌드
```bash
npm run build
```

### 3. 첫 실행
```bash
npm start
```

첫 실행 시 CLI가 자동으로:
- Telegram Bot Token 입력 요청
- Anthropic API Key 입력 요청
- `~/.companionbot/` 워크스페이스 생성
- 봇 시작

### 4. PM2 설정 (선택)
```bash
npm install -g pm2
pm2 start npm --name companionbot -- start
pm2 startup  # 시스템 재부팅 시 자동 시작
pm2 save
```

## 주요 파일 설명

### src/cli/main.ts
- 진입점
- 시크릿 확인 → 없으면 인터랙티브 설정
- 워크스페이스 초기화
- 봇 시작

### src/telegram/bot.ts
- Telegram 메시지 핸들러
- 명령어: /start, /compact, /memory, /model, /reset
- 사진 메시지 → Claude Vision으로 분석
- URL 감지 → cheerio로 파싱 후 요약

### src/ai/claude.ts
- Anthropic SDK 래퍼
- Tool Use 루프 처리
- 모델: sonnet, opus, haiku

### src/workspace/
- `paths.ts`: 경로 상수 (`~/.companionbot/`)
- `init.ts`: 워크스페이스 초기화, BOOTSTRAP 관리
- `load.ts`: 파일 읽기/쓰기, 메모리 관리

### src/tools/index.ts
- AI 도구 정의
- `change_model`: 모델 변경
- `save_memory`: 일일 메모리 저장
- `save_persona`: 온보딩 완료 시 페르소나 저장

### src/config/secrets.ts
- OS 키체인에 시크릿 저장/로드 (keytar)
- `telegram-token`, `anthropic-api-key`

## 워크스페이스 구조

`~/.companionbot/`:
```
├── IDENTITY.md    # 이름, 이모지, 바이브
├── SOUL.md        # 성격, 말투
├── USER.md        # 사용자 정보
├── AGENTS.md      # 운영 지침
├── MEMORY.md      # 장기 기억
├── BOOTSTRAP.md   # 온보딩 (완료 후 삭제됨)
└── memory/
    ├── 2026-02-08.md
    └── ...
```

## 트러블슈팅

### "Conflict: terminated by other getUpdates request"
같은 토큰으로 봇이 2개 실행 중. PM2와 npm run dev 동시 실행 시 발생.
```bash
pm2 stop companionbot  # 또는
pkill -f "tsx src/cli"
```

### 시크릿 재설정
```bash
rm -rf ~/.companionbot
npm start  # 다시 설정
```

### 빌드 에러
```bash
rm -rf node_modules dist
npm install
npm run build
```

## 개발 시 주의사항

1. **타입 안전**: TypeScript strict 모드
2. **API 형식**: Anthropic SDK 타입 사용
3. **이미지 처리**: `as const` 단언으로 리터럴 타입 유지
4. **세션 관리**: chatId 기반 Map으로 관리

## 테스트 방법

```bash
# 개발 모드로 실행
npm run dev

# Telegram에서 봇에게 메시지 전송
# - 일반 텍스트
# - 사진
# - URL 포함 메시지
```

## 기능 추가 시

1. 도구 추가: `src/tools/index.ts`의 `tools` 배열과 `executeTool` 함수
2. 명령어 추가: `src/telegram/bot.ts`의 `bot.command()`
3. 워크스페이스 파일 추가: `templates/`에 템플릿, `src/workspace/load.ts`에 로드 로직
