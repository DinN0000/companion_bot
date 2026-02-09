import * as readline from "readline";
import { getSecret, setSecret } from "../config/secrets.js";
import {
  isWorkspaceInitialized,
  initWorkspace,
  getWorkspacePath,
} from "../workspace/index.js";
import { createBot } from "../telegram/bot.js";
import { cleanupHeartbeats } from "../heartbeat/index.js";
import { cleanupBriefings } from "../briefing/index.js";
import { cleanupReminders } from "../reminders/index.js";

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function interactiveSetup(): Promise<boolean> {
  const rl = createPrompt();

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║             🤖 CompanionBot 첫 실행 가이드                    ║
╚═══════════════════════════════════════════════════════════════╝

CompanionBot은 Telegram에서 동작하는 개인 AI 비서예요.

┌─────────────────────────────────────────────────────────────┐
│  ✨ 이런 것들을 할 수 있어요:                               │
├─────────────────────────────────────────────────────────────┤
│  💬 자연스러운 대화      AI와 한국어로 자유롭게 대화       │
│  📁 파일 읽기/쓰기       문서 작성, 코드 편집 가능         │
│  🔍 웹 검색              최신 정보 검색 (Brave API)        │
│  📅 캘린더 연동          일정 확인/추가 (Google Calendar)  │
│  ⏰ 리마인더             알림 설정 ("3시에 알려줘")        │
│  🧠 메모리 기능          대화 내용 기억, 장기 기억 저장    │
│  📰 브리핑               매일 아침 날씨/일정/뉴스 요약     │
└─────────────────────────────────────────────────────────────┘

필수 설정 2개 + 선택 설정으로 시작합니다.

💡 언제든지 'q'를 입력하면 설정을 취소할 수 있어요.
`);

  try {
    // Telegram Bot Token
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1/2] Telegram Bot Token
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 Telegram에서 봇을 만들어야 해요:

   1. Telegram에서 @BotFather 검색해서 대화 시작
   2. /newbot 명령어 입력
   3. 봇 이름 입력 (예: My AI Assistant)
   4. 봇 유저네임 입력 (예: my_ai_bot) - 반드시 _bot으로 끝나야 함
   5. 토큰이 나오면 복사! (예: 123456:ABC-DEF...)

   🔗 바로가기: https://t.me/BotFather
`);

    const token = await question(rl, "   Token을 붙여넣으세요 (q=취소): ");
    if (!token || token.toLowerCase() === "q") {
      console.log("\n👋 설정을 취소했습니다. 나중에 다시 실행하세요.");
      rl.close();
      return false;
    }

    await setSecret("telegram-token", token);
    console.log("   ✓ 저장됨 (OS 키체인에 안전하게 보관)\n");

    // Anthropic API Key
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2/2] Anthropic API Key
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧠 AI 기능을 위해 Anthropic API 키가 필요해요:

   1. https://console.anthropic.com 접속
   2. 회원가입 또는 로그인
   3. Settings > API Keys 메뉴
   4. Create Key 버튼 클릭
   5. 생성된 키 복사! (sk-ant-...)

   💡 무료 크레딧이 있으니 먼저 사용해보세요!
   🔗 바로가기: https://console.anthropic.com/settings/keys
`);

    const apiKey = await question(rl, "   API Key를 붙여넣으세요 (q=취소): ");
    if (!apiKey || apiKey.toLowerCase() === "q") {
      console.log("\n👋 설정을 취소했습니다. 나중에 다시 실행하세요.");
      console.log("   (Telegram 토큰은 이미 저장됨)");
      rl.close();
      return false;
    }

    await setSecret("anthropic-api-key", apiKey);
    console.log("   ✓ 저장됨 (OS 키체인에 안전하게 보관)\n");

    // 선택적 기능 설정
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[선택] 추가 기능
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    const setupOptional = await question(rl, "   웹 검색 기능을 설정하시겠습니까? (y/n): ");

    if (setupOptional.toLowerCase() === "y") {
      console.log(`
   🔍 Brave Search API (무료 2000회/월):
   
      1. https://brave.com/search/api 접속
      2. Get Started 클릭 후 가입
      3. API 키 생성
`);
      const braveKey = await question(rl, "   Brave API Key (Enter로 건너뛰기): ");
      if (braveKey) {
        await setSecret("brave-api-key", braveKey);
        console.log("   ✓ 저장됨\n");
      } else {
        console.log("   → 건너뜀 (나중에 companionbot setup brave <KEY>로 설정 가능)\n");
      }
    }

    rl.close();
    return true;
  } catch (error) {
    rl.close();
    throw error;
  }
}

async function main() {
  // 1. 시크릿 확인
  let token = await getSecret("telegram-token");
  let apiKey = await getSecret("anthropic-api-key");

  // 2. 시크릿이 없으면 인터랙티브 설정
  if (!token || !apiKey) {
    const success = await interactiveSetup();
    if (!success) {
      process.exit(1);
    }

    // 다시 읽기
    token = await getSecret("telegram-token");
    apiKey = await getSecret("anthropic-api-key");
  }

  if (!token || !apiKey) {
    console.error("❌ 설정이 완료되지 않았습니다.");
    process.exit(1);
  }

  // 3. 워크스페이스 초기화
  const workspaceReady = await isWorkspaceInitialized();
  const workspacePath = getWorkspacePath();
  
  if (!workspaceReady) {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    📁 워크스페이스 생성                        ║
╚═══════════════════════════════════════════════════════════════╝
`);
    await initWorkspace();
    console.log(`   경로: ${workspacePath}
   
   생성된 파일들:
   ├── IDENTITY.md   ← 봇의 이름과 성격 설정
   ├── SOUL.md       ← 봇의 행동 원칙
   ├── USER.md       ← 당신에 대한 정보 (봇이 참고)
   ├── AGENTS.md     ← 봇 행동 가이드
   ├── MEMORY.md     ← 장기 기억 저장소
   └── memory/       ← 일일 메모리 폴더

   💡 팁: IDENTITY.md와 USER.md를 편집해서 봇을 커스터마이즈하세요!
`);
  }

  // 4. 환경변수 설정
  process.env.ANTHROPIC_API_KEY = apiKey;

  // 5. 봇 시작
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                      🚀 봇 시작!                              ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const bot = createBot(token);

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    console.log("\n👋 봇을 종료합니다...");
    cleanupHeartbeats();
    cleanupBriefings();
    cleanupReminders();
    await bot.stop();
    console.log("✓ 정상 종료됨");
    process.exit(0);
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  bot.start({
    onStart: (botInfo) => {
      console.log(`   ✓ @${botInfo.username} 연결됨!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   이제 Telegram에서 @${botInfo.username} 검색해서 대화해보세요!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📱 명령어 목록:
   /help       - 도움말
   /model      - AI 모델 변경 (haiku/sonnet/opus)
   /compact    - 대화 요약 (토큰 절약)
   /health     - 봇 상태 확인
   /calendar   - 캘린더 연동 (Google)

   ⌨️  Ctrl+C로 종료
   📂 워크스페이스: ${workspacePath}
`);
    },
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
