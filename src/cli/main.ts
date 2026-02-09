import * as readline from "readline";
import { checkbox, input, confirm, Separator } from "@inquirer/prompts";
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

interface FeatureSelection {
  webSearch: boolean;
  calendar: boolean;
  weather: boolean;
}

async function interactiveSetup(): Promise<boolean> {
  const rl = createPrompt();

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║             🤖 CompanionBot 첫 실행 가이드                    ║
╚═══════════════════════════════════════════════════════════════╝

CompanionBot은 Telegram에서 동작하는 개인 AI 비서예요.

💡 언제든지 'q'를 입력하면 설정을 취소할 수 있어요.
`);

  try {
    // ===== STEP 1: 기능 선택 =====
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[STEP 1] 사용할 기능 선택
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────────────────────────────────────────────────────┐
│  [필수] 기본 기능 (자동 포함)                                │
│  ├─ 💬 AI 대화         자연스러운 한국어 대화               │
│  ├─ 📁 파일 관리       문서/코드 읽기·쓰기                  │
│  ├─ ⏰ 리마인더        알림 설정 ("3시에 알려줘")           │
│  └─ 🧠 메모리          대화 기억, 장기 기억 저장            │
└──────────────────────────────────────────────────────────────┘
`);

    const features: FeatureSelection = {
      webSearch: false,
      calendar: false,
      weather: false,
    };

    let selectedValues: string[] = [];
    try {
      selectedValues = await checkbox({
        message: "추가 기능 선택 (Space=선택, Enter=확정)",
        choices: [
          { 
            name: "🔍 웹 검색 - 최신 정보 검색 (Brave API, 무료 2000/월)", 
            value: "webSearch" 
          },
          { 
            name: "📅 캘린더 - Google Calendar 일정 확인/추가", 
            value: "calendar" 
          },
          { 
            name: "🌤️  날씨 - 현재 날씨, 브리핑 (OpenWeatherMap, 무료)", 
            value: "weather" 
          },
          new Separator("───────────────────────────────────────────"),
          new Separator("● 건너뛰기 - 바로 Enter를 누르세요"),
        ],
      });
    } catch {
      console.log("\n👋 설정을 취소했습니다.");
      rl.close();
      return false;
    }

    features.webSearch = selectedValues.includes("webSearch");
    features.calendar = selectedValues.includes("calendar");
    features.weather = selectedValues.includes("weather");

    // 선택 요약
    const selectedFeatures = [];
    if (features.webSearch) selectedFeatures.push("🔍 웹 검색");
    if (features.calendar) selectedFeatures.push("📅 캘린더");
    if (features.weather) selectedFeatures.push("🌤️ 날씨");

    console.log(`
   ✓ 선택됨: ${selectedFeatures.length > 0 ? selectedFeatures.join(", ") : "기본 기능만"}
`);

    // ===== STEP 2: 필수 API 키 =====
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[STEP 2] 필수 API 키 입력
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

    // Telegram Bot Token
    console.log(`   📱 Telegram Bot Token
   
      1. Telegram에서 @BotFather 검색
      2. /newbot → 이름 입력 → 유저네임 입력 (_bot으로 끝나야 함)
      3. 토큰 복사 (예: 123456:ABC-DEF...)
      🔗 https://t.me/BotFather
`);
    const token = await question(rl, "      Token: ");
    if (!token || token.toLowerCase() === "q") {
      console.log("\n👋 설정을 취소했습니다.");
      rl.close();
      return false;
    }
    await setSecret("telegram-token", token);
    console.log("      ✓ 저장됨\n");

    // Anthropic API Key
    console.log(`   🧠 Anthropic API Key
   
      1. https://console.anthropic.com 접속 (회원가입/로그인)
      2. Settings > API Keys > Create Key
      3. 키 복사 (sk-ant-...)
      🔗 https://console.anthropic.com/settings/keys
`);
    const apiKey = await question(rl, "      API Key: ");
    if (!apiKey || apiKey.toLowerCase() === "q") {
      console.log("\n👋 설정을 취소했습니다. (Telegram 토큰은 저장됨)");
      rl.close();
      return false;
    }
    await setSecret("anthropic-api-key", apiKey);
    console.log("      ✓ 저장됨\n");

    // ===== STEP 3: 선택 API 키 =====
    if (features.webSearch || features.calendar || features.weather) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[STEP 3] 선택한 기능 API 키 입력
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enter를 누르면 해당 기능을 건너뛸 수 있어요.
`);

      // 웹 검색 API
      if (features.webSearch) {
        console.log(`   🔍 Brave Search API (무료 2000회/월)
   
      1. https://brave.com/search/api 접속
      2. Get Started > 가입 > API 키 생성
`);
        const braveKey = await question(rl, "      API Key (Enter=건너뛰기, q=취소): ");
        if (braveKey.toLowerCase() === "q") {
          console.log("\n👋 설정을 취소했습니다.");
          rl.close();
          return false;
        }
        if (braveKey) {
          await setSecret("brave-api-key", braveKey);
          console.log("      ✓ 저장됨\n");
        } else {
          console.log("      → 건너뜀 (나중에: companionbot setup brave <KEY>)\n");
        }
      }

      // 날씨 API
      if (features.weather) {
        console.log(`   🌤️  OpenWeatherMap API (무료)
   
      1. https://openweathermap.org 접속 > Sign Up
      2. API Keys 메뉴에서 키 확인/생성
`);
        const weatherKey = await question(rl, "      API Key (Enter=건너뛰기, q=취소): ");
        if (weatherKey.toLowerCase() === "q") {
          console.log("\n👋 설정을 취소했습니다.");
          rl.close();
          return false;
        }
        if (weatherKey) {
          await setSecret("openweathermap-api-key", weatherKey);
          console.log("      ✓ 저장됨\n");
        } else {
          console.log("      → 건너뜀 (나중에: companionbot setup weather <KEY>)\n");
        }
      }

      // 캘린더
      if (features.calendar) {
        console.log(`   📅 Google Calendar
   
      캘린더는 봇 실행 후 /calendar_setup 명령어로 설정합니다.
      (OAuth 인증이 필요해서 브라우저가 열려요)
`);
        await question(rl, "      Enter를 눌러 계속...");
        console.log("");
      }
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 설정 완료!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

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
