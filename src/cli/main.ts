import * as readline from "readline";
import { checkbox, select, input, confirm, password, Separator } from "@inquirer/prompts";
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
import { preloadEmbeddingModel, preloadVectorStore } from "../memory/index.js";
import { saveFeatures, loadFeatures, logFeatures, type FeatureSelection } from "../config/features.js";

// ===== CLI 옵션 =====
let nonInteractiveMode = false;

// ===== CLI 서브커맨드 처리 =====
async function handleSetupCommand(args: string[]): Promise<boolean> {
  const subcommand = args[0];
  const value = args[1];

  switch (subcommand) {
    case "weather":
      if (!value) {
        console.log("사용법: companionbot setup weather <API_KEY>");
        console.log("\nOpenWeatherMap API 키를 설정합니다.");
        console.log("키 발급: https://openweathermap.org/api");
        return true;
      }
      await setSecret("openweathermap-api-key", value.trim());
      console.log("✓ OpenWeatherMap API Key가 OS 키체인에 저장되었습니다.");
      return true;

    case "brave":
      if (!value) {
        console.log("사용법: companionbot setup brave <API_KEY>");
        console.log("\nBrave Search API 키를 설정합니다.");
        console.log("키 발급: https://brave.com/search/api");
        return true;
      }
      await setSecret("brave-api-key", value.trim());
      console.log("✓ Brave Search API Key가 OS 키체인에 저장되었습니다.");
      return true;

    case "telegram":
      if (!value) {
        console.log("사용법: companionbot setup telegram <TOKEN>");
        console.log("\nTelegram Bot Token을 설정합니다.");
        console.log("토큰 발급: https://t.me/BotFather");
        return true;
      }
      await setSecret("telegram-token", value.trim());
      console.log("✓ Telegram Bot Token이 OS 키체인에 저장되었습니다.");
      return true;

    case "anthropic":
      if (!value) {
        console.log("사용법: companionbot setup anthropic <API_KEY>");
        console.log("\nAnthropic API 키를 설정합니다.");
        console.log("키 발급: https://console.anthropic.com/settings/keys");
        return true;
      }
      await setSecret("anthropic-api-key", value.trim());
      console.log("✓ Anthropic API Key가 OS 키체인에 저장되었습니다.");
      return true;

    case "calendar":
      console.log("📅 Google Calendar 설정");
      console.log("\nCompanionBot 실행 후 /calendar_setup 명령어로 설정합니다.");
      console.log("(OAuth 인증이 필요해서 브라우저가 열립니다)");
      return true;

    default:
      console.log(`
CompanionBot 설정

사용법:
  companionbot setup weather <API_KEY>     OpenWeatherMap API 키 설정
  companionbot setup brave <API_KEY>       Brave Search API 키 설정
  companionbot setup telegram <TOKEN>      Telegram Bot Token 설정
  companionbot setup anthropic <API_KEY>   Anthropic API 키 설정
  companionbot setup calendar              Google Calendar 설정 안내
`);
      return true;
  }
}

// CLI 인자 처리
async function handleCLIArgs(): Promise<boolean> {
  const args = process.argv.slice(2);
  
  // 플래그 필터링 (-n, --no-interactive)
  const filteredArgs: string[] = [];
  for (const arg of args) {
    if (arg === "-n" || arg === "--no-interactive") {
      nonInteractiveMode = true;
    } else {
      filteredArgs.push(arg);
    }
  }
  
  if (filteredArgs.length === 0) {
    return false; // 서브커맨드 없음, 봇 시작
  }

  const command = filteredArgs[0];

  switch (command) {
    case "setup":
      return handleSetupCommand(filteredArgs.slice(1));

    case "--help":
    case "-h":
      console.log(`
CompanionBot - Claude 기반 AI 동반자

사용법:
  companionbot                 봇 시작 (첫 실행 시 설정 안내)
  companionbot -n              봇 시작 (환경변수 모드, Docker/CI용)
  companionbot setup <...>     API 키 설정

설정 명령어:
  companionbot setup weather <KEY>     날씨 API 설정 (OpenWeatherMap)
  companionbot setup brave <KEY>       웹 검색 API 설정 (Brave)
  companionbot setup telegram <TOKEN>  Telegram 토큰 설정
  companionbot setup anthropic <KEY>   Anthropic API 설정
  companionbot setup calendar          캘린더 설정 안내

옵션:
  -n, --no-interactive  환경변수 모드 (프롬프트 없이 실행)
                        필수 환경변수: TELEGRAM_TOKEN, ANTHROPIC_API_KEY
  -h, --help            도움말 표시
  -v, --version         버전 표시

환경변수 (--no-interactive 모드):
  TELEGRAM_TOKEN        Telegram Bot Token (필수)
  ANTHROPIC_API_KEY     Anthropic API Key (필수)
  BRAVE_API_KEY         Brave Search API Key (선택)
  OPENWEATHERMAP_API_KEY OpenWeatherMap API Key (선택)
`);
      return true;

    case "--version":
    case "-v":
      // package.json에서 버전 읽기
      try {
        const { readFile } = await import("fs/promises");
        const { fileURLToPath } = await import("url");
        const { dirname, join } = await import("path");
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const pkgPath = join(__dirname, "..", "..", "package.json");
        const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
        console.log(`CompanionBot v${pkg.version}`);
      } catch {
        console.log("CompanionBot (버전 정보 없음)");
      }
      return true;

    default:
      console.log(`알 수 없는 명령어: ${command}`);
      console.log("도움말: companionbot --help");
      return true;
  }
}

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

// FeatureSelection은 ../config/features.js에서 import

// 토큰/API 키 형식 검증
function validateTelegramToken(token: string): boolean {
  // Telegram 토큰 형식: 숫자:영문숫자_-
  // 예: 123456789:ABCdefGHI-jkl_123
  const pattern = /^\d+:[A-Za-z0-9_-]+$/;
  return pattern.test(token);
}

function validateAnthropicKey(key: string): boolean {
  // Anthropic API 키: sk-ant- 로 시작
  return key.startsWith("sk-ant-");
}

async function interactiveSetup(): Promise<boolean> {
  const rl = createPrompt();

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║             🤖 CompanionBot 첫 실행 가이드                    ║
╚═══════════════════════════════════════════════════════════════╝

CompanionBot은 당신과 함께하는 AI 동반자예요.
Telegram에서 대화하며 일정 관리, 메모, 검색 등을 도와줍니다.

✨ 당신만의 CompanionBot을 만들어보세요!

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
          { name: "🔍 웹 검색 - Brave API, 무료 2000/월", value: "webSearch" },
          { name: "📅 캘린더 - Google Calendar 연동", value: "calendar" },
          { name: "🌤️  날씨 - OpenWeatherMap, 무료", value: "weather" },
          new Separator("  ● 다음 단계로"),
        ],
      });
    } catch {
      console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
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
    const existingToken = await getSecret("telegram-token");
    let skipToken = false;
    
    if (existingToken) {
      console.log(`   📱 Telegram Bot Token
      ✓ 이미 설정됨 (${existingToken.slice(0, 8)}...)\n`);
      try {
        skipToken = await confirm({
          message: "기존 값을 사용할까요?",
          default: true,
        });
      } catch {
        console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
        rl.close();
        return false;
      }
    }

    if (!skipToken) {
      console.log(`   📱 Telegram Bot Token
   
      1. Telegram에서 @BotFather 검색
      2. /newbot → 이름 입력 → 유저네임 입력 (_bot으로 끝나야 함)
      3. 토큰 복사 (예: 123456:ABC-DEF...)
      🔗 https://t.me/BotFather
`);
      let token: string;
      try {
        token = await password({
          message: "Token:",
          mask: "*",
          validate: (value) => {
            if (!value || value.toLowerCase() === "q") return true; // Allow cancel
            if (!validateTelegramToken(value)) {
              return "형식 오류: 숫자:영문숫자_- (예: 123456789:ABC-def_123)";
            }
            return true;
          },
        });
      } catch {
        console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
        rl.close();
        return false;
      }
      if (!token || token.toLowerCase() === "q") {
        console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
        rl.close();
        return false;
      }
      await setSecret("telegram-token", token);
      console.log("      ✓ 저장됨\n");
    }

    // Anthropic API Key
    const existingApiKey = await getSecret("anthropic-api-key");
    let skipApiKey = false;
    
    if (existingApiKey) {
      console.log(`   🧠 Anthropic API Key
      ✓ 이미 설정됨 (${existingApiKey.slice(0, 12)}...)\n`);
      try {
        skipApiKey = await confirm({
          message: "기존 값을 사용할까요?",
          default: true,
        });
      } catch {
        console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
        rl.close();
        return false;
      }
    }

    if (!skipApiKey) {
      console.log(`   🧠 Anthropic API Key
   
      1. https://console.anthropic.com 접속 (회원가입/로그인)
      2. Settings > API Keys > Create Key
      3. 키 복사 (sk-ant-...)
      🔗 https://console.anthropic.com/settings/keys
`);
      let apiKey: string;
      try {
        apiKey = await password({
          message: "API Key:",
          mask: "*",
          validate: (value) => {
            if (!value || value.toLowerCase() === "q") return true; // Allow cancel
            if (!validateAnthropicKey(value)) {
              return "형식 오류: sk-ant- 로 시작해야 합니다";
            }
            return true;
          },
        });
      } catch {
        console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
        rl.close();
        return false;
      }
      if (!apiKey || apiKey.toLowerCase() === "q") {
        console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
        rl.close();
        return false;
      }
      await setSecret("anthropic-api-key", apiKey);
      console.log("      ✓ 저장됨\n");
    }

    // ===== STEP 3: 선택 API 키 =====
    if (features.webSearch || features.calendar || features.weather) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[STEP 3] 선택한 기능 API 키 입력
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enter를 누르면 해당 기능을 건너뛸 수 있어요.
`);

      // 웹 검색 API
      if (features.webSearch) {
        const existingBraveKey = await getSecret("brave-api-key");
        let skipBrave = false;
        
        if (existingBraveKey) {
          console.log(`   🔍 Brave Search API
      ✓ 이미 설정됨 (${existingBraveKey.slice(0, 8)}...)\n`);
          try {
            skipBrave = await confirm({
              message: "기존 값을 사용할까요?",
              default: true,
            });
          } catch {
            console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
            rl.close();
            return false;
          }
        }
        
        if (!skipBrave) {
          console.log(`   🔍 Brave Search API (무료 2000회/월)
   
      1. https://brave.com/search/api 접속
      2. Get Started > 가입 > API 키 생성
`);
          const braveKey = await question(rl, "      API Key (Enter=건너뛰기, q=취소): ");
          if (braveKey.toLowerCase() === "q") {
            console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
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
      }

      // 날씨 API
      if (features.weather) {
        const existingWeatherKey = await getSecret("openweathermap-api-key");
        let skipWeather = false;
        
        if (existingWeatherKey) {
          console.log(`   🌤️  OpenWeatherMap API
      ✓ 이미 설정됨 (${existingWeatherKey.slice(0, 8)}...)\n`);
          try {
            skipWeather = await confirm({
              message: "기존 값을 사용할까요?",
              default: true,
            });
          } catch {
            console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
            rl.close();
            return false;
          }
        }
        
        if (!skipWeather) {
          console.log(`   🌤️  OpenWeatherMap API (무료)
   
      1. https://openweathermap.org 접속 > Sign Up
      2. API Keys 메뉴에서 키 확인/생성
`);
          const weatherKey = await question(rl, "      API Key (Enter=건너뛰기, q=취소): ");
          if (weatherKey.toLowerCase() === "q") {
            console.log("\n👋 설정을 취소했습니다. (이미 저장된 값은 유지됨)");
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
      }

      // 캘린더
      if (features.calendar) {
        console.log(`   📅 Google Calendar
   
      캘린더는 CompanionBot 실행 후 /calendar_setup 명령어로 설정합니다.
      (OAuth 인증이 필요해서 브라우저가 열려요)
`);
        await question(rl, "      Enter를 눌러 계속...");
        console.log("");
      }
    }

    // 기능 선택 상태 저장
    saveFeatures(features);

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
  // 0. CLI 서브커맨드 처리
  const handled = await handleCLIArgs();
  if (handled) {
    process.exit(0);
  }

  let token: string | undefined;
  let apiKey: string | undefined;

  // Non-interactive 모드: 환경변수에서만 읽기
  if (nonInteractiveMode) {
    token = process.env.TELEGRAM_TOKEN;
    apiKey = process.env.ANTHROPIC_API_KEY;

    const missing: string[] = [];
    if (!token) missing.push("TELEGRAM_TOKEN");
    if (!apiKey) missing.push("ANTHROPIC_API_KEY");

    if (missing.length > 0) {
      console.error(`❌ Non-interactive 모드: 필수 환경변수 누락

누락된 환경변수:
${missing.map(v => `  - ${v}`).join("\n")}

사용 예시:
  TELEGRAM_TOKEN=xxx ANTHROPIC_API_KEY=xxx companionbot -n

Docker 예시:
  docker run -e TELEGRAM_TOKEN=xxx -e ANTHROPIC_API_KEY=xxx companionbot
`);
      process.exit(1);
    }

    // 선택적 환경변수도 설정
    if (process.env.BRAVE_API_KEY) {
      await setSecret("brave-api-key", process.env.BRAVE_API_KEY);
    }
    if (process.env.OPENWEATHERMAP_API_KEY) {
      await setSecret("openweathermap-api-key", process.env.OPENWEATHERMAP_API_KEY);
    }

    // 환경변수 기반으로 features 자동 설정
    const features: FeatureSelection = {
      webSearch: !!process.env.BRAVE_API_KEY,
      weather: !!process.env.OPENWEATHERMAP_API_KEY,
      calendar: false, // OAuth 필요하므로 non-interactive에서는 비활성화
    };
    saveFeatures(features);

    console.log("✓ Non-interactive 모드: 환경변수에서 설정 로드됨");
  } else {
    // Interactive 모드: 키체인에서 읽기
    token = await getSecret("telegram-token") ?? undefined;
    apiKey = await getSecret("anthropic-api-key") ?? undefined;

    // 시크릿이 없으면 인터랙티브 설정
    if (!token || !apiKey) {
      const success = await interactiveSetup();
      if (!success) {
        process.exit(1);
      }

      // 다시 읽기
      token = await getSecret("telegram-token") ?? undefined;
      apiKey = await getSecret("anthropic-api-key") ?? undefined;
    }
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
   ├── IDENTITY.md   ← CompanionBot의 이름과 성격
   ├── SOUL.md       ← CompanionBot의 행동 원칙
   ├── USER.md       ← 당신에 대한 정보
   ├── AGENTS.md     ← 운영 가이드
   ├── MEMORY.md     ← 장기 기억 저장소
   └── memory/       ← 일일 메모리 폴더

   💡 팁: IDENTITY.md와 USER.md를 편집해서 나만의 CompanionBot을 만드세요!
`);
  }

  // 4. 환경변수 설정
  process.env.ANTHROPIC_API_KEY = apiKey;

  // 5. 🚀 사전 로딩 (첫 응답 속도 개선)
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   ⏳ 시스템 사전 로딩...                       ║
╚═══════════════════════════════════════════════════════════════╝
`);
  
  const preloadStart = Date.now();
  
  // 임베딩 모델 + 벡터 저장소 병렬 로딩
  await Promise.all([
    preloadEmbeddingModel(),
    preloadVectorStore(),
  ]);
  
  console.log(`   ✓ 사전 로딩 완료 (${Date.now() - preloadStart}ms)
`);

  // 6. 활성화된 기능 표시
  const enabledFeatures = loadFeatures();
  const featureList = [];
  if (enabledFeatures.webSearch) featureList.push("🔍 웹 검색");
  if (enabledFeatures.calendar) featureList.push("📅 캘린더");
  if (enabledFeatures.weather) featureList.push("🌤️ 날씨");

  // 7. CompanionBot 시작
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  🚀 CompanionBot 시작!                        ║
╚═══════════════════════════════════════════════════════════════╝

   활성화된 기능: ${featureList.length > 0 ? featureList.join(", ") : "기본 기능만"}
`);

  const bot = createBot(token);

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    console.log("\n👋 CompanionBot을 종료합니다...");
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
   /help           - 도움말
   /model          - AI 모델 변경 (haiku/sonnet/opus)
   /compact        - 대화 요약 (토큰 절약)
   /health         - 상태 확인
   /calendar_setup - 캘린더 연동 (Google)

   ⌨️  Ctrl+C로 종료
   📂 워크스페이스: ${workspacePath}
`);
    },
  });
}

main().catch((err) => {
  console.error("\n❌ CompanionBot 시작 실패\n");
  
  // 에러 유형별 안내
  const errMsg = err instanceof Error ? err.message : String(err);
  
  if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
    console.error(`🔑 Telegram 토큰이 유효하지 않습니다.

해결 방법:
  1. @BotFather에서 토큰 재확인
  2. companionbot setup telegram <새토큰> 으로 업데이트
  3. 토큰 형식: 123456789:ABCdef... (숫자:문자열)
`);
  } else if (errMsg.includes("키체인") || err.name === "KeychainError") {
    console.error(errMsg);
  } else if (errMsg.includes("ANTHROPIC") || errMsg.includes("authentication")) {
    console.error(`🧠 Anthropic API 키가 유효하지 않습니다.

해결 방법:
  1. https://console.anthropic.com/settings/keys 에서 키 확인
  2. companionbot setup anthropic <새키> 으로 업데이트
  3. 키 형식: sk-ant-api03-...
`);
  } else {
    console.error(`오류: ${errMsg}

문제가 지속되면:
  • GitHub Issues: https://github.com/DinN0000/CompanionBot/issues
  • 로그 확인: companionbot --verbose (준비 중)
`);
  }
  
  process.exit(1);
});
