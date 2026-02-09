import { Bot } from "grammy";
import { limit } from "@grammyjs/ratelimiter";
import { setBotInstance, restoreReminders } from "../reminders/index.js";
import { setBriefingBot, restoreBriefings } from "../briefing/index.js";
import { setHeartbeatBot, restoreHeartbeats } from "../heartbeat/index.js";
import { setAgentBot } from "../agents/index.js";
import { setCronBot, restoreCronJobs } from "../cron/index.js";
import { registerCommands, registerMessageHandlers } from "./handlers/index.js";
import { warmup } from "../warmup.js";

// Re-export for external use
export { invalidateWorkspaceCache } from "./utils/index.js";

/**
 * 🚀 봇 시작 전 초기화 작업들을 병렬로 수행합니다.
 * 
 * - Warmup (임베딩 모델, 워크스페이스, 메모리 청크)
 * - Restore (리마인더, 브리핑, 하트비트, 크론)
 */
async function initializeInBackground(bot: Bot): Promise<void> {
  const startTime = Date.now();
  
  // 봇 인스턴스 설정 (동기 - 반드시 restore 전에)
  setBotInstance(bot);
  setBriefingBot(bot);
  setHeartbeatBot(bot);
  setAgentBot(bot);
  setCronBot(bot);

  // 모든 비동기 초기화를 병렬로 수행
  const results = await Promise.allSettled([
    // 🚀 Warmup (임베딩 모델 + 워크스페이스 + 메모리)
    warmup(),
    
    // 📋 Restore 작업들 (서로 독립적이므로 병렬 가능)
    restoreReminders(),
    restoreBriefings(),
    restoreHeartbeats(),
    restoreCronJobs(),
  ]);

  // 에러 로깅 (치명적이지 않음)
  const taskNames = ["warmup", "reminders", "briefings", "heartbeats", "cron"];
  for (const [idx, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error(`[Init] Failed to ${taskNames[idx]}:`, result.reason);
    }
  }

  console.log(`[Init] Background initialization complete in ${Date.now() - startTime}ms`);
}

/**
 * Telegram 봇을 생성하고 초기화합니다.
 * 
 * 🚀 콜드 스타트 최적화:
 * - 무거운 초기화 작업들은 백그라운드에서 병렬 수행
 * - 봇은 즉시 시작하여 메시지 수신 가능
 * - 첫 메시지 시점에 warmup이 완료되어 있으면 즉시 응답 가능
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // 🚀 백그라운드에서 초기화 시작 (봇 시작을 블로킹하지 않음)
  // 첫 메시지가 오기 전에 warmup이 완료되면 첫 응답 지연 없음
  initializeInBackground(bot).catch((err) => {
    console.error("[Init] Background initialization failed:", err);
  });

  // Rate limiting - 1분에 10개 메시지
  bot.use(limit({
    timeFrame: 60000, // 1분
    limit: 10,
    onLimitExceeded: async (ctx) => {
      await ctx.reply("⚠️ 너무 빠르게 메시지를 보내고 있어요. 잠시 후 다시 시도해주세요.");
    },
  }));

  // 에러 핸들링
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  // 명령어 목록 등록
  bot.api
    .setMyCommands([
      { command: "help", description: "도움말 보기" },
      { command: "model", description: "AI 모델 변경" },
      { command: "compact", description: "대화 정리하기" },
      { command: "memory", description: "최근 기억 보기" },
      { command: "health", description: "봇 상태 확인" },
    ])
    .catch((err) => console.error("Failed to set commands:", err));

  // 핸들러 등록
  registerCommands(bot);
  registerMessageHandlers(bot);

  return bot;
}
