import * as readline from "readline";
import { getSecret, setSecret } from "../config/secrets.js";
import {
  isWorkspaceInitialized,
  initWorkspace,
  getWorkspacePath,
} from "../workspace/index.js";
import { createBot } from "../telegram/bot.js";

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

  console.log("\n🤖 CompanionBot 첫 실행입니다!\n");

  try {
    // Telegram Bot Token
    console.log("[1/2] Telegram Bot Token");
    console.log("      @BotFather에서 봇 생성 후 토큰을 붙여넣으세요.");
    console.log("      (https://t.me/BotFather)\n");

    const token = await question(rl, "      Token: ");
    if (!token) {
      console.log("\n❌ 토큰이 필요합니다.");
      rl.close();
      return false;
    }

    await setSecret("telegram-token", token);
    console.log("      ✓ 저장됨\n");

    // Anthropic API Key
    console.log("[2/2] Anthropic API Key");
    console.log("      console.anthropic.com에서 발급받으세요.");
    console.log("      (https://console.anthropic.com/settings/keys)\n");

    const apiKey = await question(rl, "      API Key: ");
    if (!apiKey) {
      console.log("\n❌ API 키가 필요합니다.");
      rl.close();
      return false;
    }

    await setSecret("anthropic-api-key", apiKey);
    console.log("      ✓ 저장됨\n");

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
  if (!workspaceReady) {
    console.log("📁 워크스페이스 생성 중...");
    await initWorkspace();
    console.log(`   → ${getWorkspacePath()} 생성 완료\n`);
  }

  // 4. 환경변수 설정
  process.env.ANTHROPIC_API_KEY = apiKey;

  // 5. 봇 시작
  console.log("🚀 봇을 시작합니다!\n");

  const bot = createBot(token);

  // 종료 핸들링
  process.once("SIGINT", () => {
    console.log("\n👋 봇을 종료합니다...");
    bot.stop();
  });
  process.once("SIGTERM", () => {
    bot.stop();
  });

  bot.start({
    onStart: (botInfo) => {
      console.log(`✓ @${botInfo.username} 시작됨`);
      console.log(`  텔레그램에서 대화를 시작하세요!\n`);
    },
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
