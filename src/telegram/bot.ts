import { Bot } from "grammy";
import { setBotInstance, restoreReminders } from "../reminders/index.js";
import { setBriefingBot, restoreBriefings } from "../briefing/index.js";
import { setHeartbeatBot, restoreHeartbeats } from "../heartbeat/index.js";
import { setAgentBot } from "../agents/index.js";
import { setCronBot, restoreCronJobs } from "../cron/index.js";
import { registerCommands, registerMessageHandlers } from "./handlers/index.js";

// Re-export for external use
export { invalidateWorkspaceCache } from "./utils/index.js";

/**
 * Telegram 봇을 생성하고 초기화합니다.
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // 리마인더 시스템 초기화
  setBotInstance(bot);
  restoreReminders().catch((err) =>
    console.error("Failed to restore reminders:", err)
  );

  // 일일 브리핑 초기화
  setBriefingBot(bot);
  restoreBriefings().catch((err) =>
    console.error("Failed to restore briefings:", err)
  );

  // Heartbeat 초기화
  setHeartbeatBot(bot);
  restoreHeartbeats().catch((err) =>
    console.error("Failed to restore heartbeats:", err)
  );

  // Sub-agent 시스템 초기화
  setAgentBot(bot);

  // Cron 시스템 초기화
  setCronBot(bot);
  restoreCronJobs().catch((err) =>
    console.error("Failed to restore cron jobs:", err)
  );

  // 에러 핸들링
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  // 명령어 목록 등록
  bot.api
    .setMyCommands([
      { command: "compact", description: "대화 정리하기" },
      { command: "memory", description: "최근 기억 보기" },
      { command: "reminders", description: "알림 목록 보기" },
    ])
    .catch((err) => console.error("Failed to set commands:", err));

  // 핸들러 등록
  registerCommands(bot);
  registerMessageHandlers(bot);

  return bot;
}
