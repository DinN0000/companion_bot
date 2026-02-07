import { getSecret, setSecret, deleteSecret } from "../config/secrets.js";
import {
  isWorkspaceInitialized,
  initWorkspace,
  getWorkspacePath,
} from "../workspace/index.js";

async function showStatus() {
  console.log("\n=== CompanionBot 설정 상태 ===\n");

  const telegram = await getSecret("telegram-token");
  const anthropic = await getSecret("anthropic-api-key");
  const workspaceReady = await isWorkspaceInitialized();

  console.log(`Telegram Bot Token: ${telegram ? "✓ 설정됨" : "✗ 미설정"}`);
  console.log(`Anthropic API Key:  ${anthropic ? "✓ 설정됨" : "✗ 미설정"}`);
  console.log(`워크스페이스:       ${workspaceReady ? "✓ 초기화됨" : "✗ 미초기화"}`);
  if (workspaceReady) {
    console.log(`  경로: ${getWorkspacePath()}`);
  }
  console.log();
}

async function setupTelegram(token: string) {
  if (!token.trim()) {
    console.log("Error: 토큰을 입력해주세요.");
    return;
  }

  await setSecret("telegram-token", token.trim());
  console.log("✓ Telegram Bot Token이 OS 키체인에 저장되었습니다.");
}

async function setupAnthropic(key: string) {
  if (!key.trim()) {
    console.log("Error: API 키를 입력해주세요.");
    return;
  }

  await setSecret("anthropic-api-key", key.trim());
  console.log("✓ Anthropic API Key가 OS 키체인에 저장되었습니다.");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const value = args[1];

  switch (command) {
    case "status":
      await showStatus();
      break;
    case "telegram":
      if (!value) {
        console.log("사용법: npm run setup telegram <TOKEN>");
        return;
      }
      await setupTelegram(value);
      break;
    case "anthropic":
      if (!value) {
        console.log("사용법: npm run setup anthropic <API_KEY>");
        return;
      }
      await setupAnthropic(value);
      break;
    case "delete":
      if (value === "telegram") {
        await deleteSecret("telegram-token");
        console.log("✓ Telegram Bot Token 삭제됨");
      } else if (value === "anthropic") {
        await deleteSecret("anthropic-api-key");
        console.log("✓ Anthropic API Key 삭제됨");
      } else {
        console.log("사용법: npm run setup delete <telegram|anthropic>");
      }
      break;
    case "init":
      if (await isWorkspaceInitialized()) {
        console.log("워크스페이스가 이미 초기화되어 있습니다.");
        console.log(`경로: ${getWorkspacePath()}`);
      } else {
        await initWorkspace();
        console.log("✓ 워크스페이스 초기화 완료");
        console.log(`경로: ${getWorkspacePath()}`);
      }
      break;
    case "reset":
      if (value === "workspace") {
        const { rm } = await import("fs/promises");
        await rm(getWorkspacePath(), { recursive: true, force: true });
        await initWorkspace();
        console.log("✓ 워크스페이스 초기화됨");
      } else {
        console.log("사용법: npm run setup reset workspace");
      }
      break;
    default:
      console.log(`
CompanionBot 설정

사용법:
  npm run setup status                      현재 설정 상태 확인
  npm run setup telegram <TOKEN>            Telegram Bot Token 설정
  npm run setup anthropic <API_KEY>         Anthropic API Key 설정
  npm run setup delete <telegram|anthropic> 키 삭제
  npm run setup init                        워크스페이스 초기화
  npm run setup reset workspace             워크스페이스 리셋
      `);
  }
}

main().catch(console.error);
