# CompanionBot - 다음 할 일

## 현재 상태
- ✅ 텔레그램 봇 + Claude 연결 완료
- ✅ Tool Use (파일 읽기/쓰기, 명령 실행) 완료
- ✅ 모델 변경 (sonnet/opus/haiku) 완료
- ⏳ 장기 기억 (세션 저장) - 다음 작업

## 다음 작업: 장기 기억 구현

봇 재시작해도 대화가 유지되도록 JSONL 파일로 저장하는 기능

### 시작 방법

```bash
cd /Users/hwai/Documents/companionbot
claude
```

Claude Code에서 입력:
```
/superpowers:executing-plans docs/plans/2026-02-06-session-persistence.md
```

### 구현 계획 요약 (6 tasks)
1. data/sessions 디렉토리 생성
2. 세션 저장 모듈 작성 (storage.ts)
3. state.ts에 저장 기능 통합
4. bot.ts 업데이트 (async 함수 사용)
5. tools/index.ts 업데이트
6. 테스트

## 봇 실행 방법

```bash
cd /Users/hwai/Documents/companionbot
npm run dev
```

## 참고 문서
- 전체 설계: `docs/plans/2026-02-05-companionbot-design.md`
- 장기 기억 구현 계획: `docs/plans/2026-02-06-session-persistence.md`
