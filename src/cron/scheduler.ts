/**
 * Cron Scheduler
 *
 * Manages the execution of scheduled cron jobs.
 * Runs every minute to check for due jobs and execute them.
 */

import type { Bot } from "grammy";
import type { CronJob, SystemEventPayload, AgentTurnPayload, Payload, CreateJobOptions } from "./types.js";
import { getDueJobs, markJobExecuted, loadJobs, addJob, removeJob, updateJob, getJobsByChat } from "./store.js";
import { chat, type Message, type ModelId } from "../ai/claude.js";
import { buildSystemPrompt } from "../telegram/utils/prompt.js";

// Scheduler state
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let botInstance: Bot | null = null;

/**
 * CronScheduler class
 * Manages the lifecycle of scheduled job execution
 */
export class CronScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private bot: Bot;
  private running = false;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  /**
   * Start the scheduler - checks every minute for due jobs
   */
  start(): void {
    if (this.running) {
      console.log("[CronScheduler] Already running");
      return;
    }

    console.log("[CronScheduler] Starting...");
    this.running = true;

    // Run immediately on start
    this.checkAndRun().catch((err: Error) =>
      console.error("[CronScheduler] Initial check failed:", err)
    );

    // Then check every minute
    this.interval = setInterval(() => {
      this.checkAndRun().catch((err: Error) =>
        console.error("[CronScheduler] Check failed:", err)
      );
    }, 60 * 1000); // 1 minute

    console.log("[CronScheduler] Started - checking every minute");
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) {
      console.log("[CronScheduler] Not running");
      return;
    }

    console.log("[CronScheduler] Stopping...");
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    this.running = false;
    console.log("[CronScheduler] Stopped");
  }

  /**
   * Check for due jobs and execute them
   */
  async checkAndRun(): Promise<void> {
    const dueJobs = await getDueJobs();
    
    if (dueJobs.length === 0) {
      return;
    }

    console.log(`[CronScheduler] Found ${dueJobs.length} due job(s)`);

    // Execute each job - errors don't affect other jobs
    for (const job of dueJobs) {
      try {
        await executeJob(job, this.bot);
        await markJobExecuted(job.id);
        console.log(`[CronScheduler] Executed job: ${job.name || job.id}`);
      } catch (error) {
        console.error(`[CronScheduler] Job ${job.id} failed:`, error);
        // Continue with other jobs - don't let one failure stop everything
      }
    }
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Execute a cron job based on its payload type
 */
export async function executeJob(job: CronJob, bot: Bot): Promise<void> {
  const payload = job.payload;
  const payloadKind = payload?.kind ?? "command";
  
  console.log(`[Cron] Executing job: ${job.name || job.id} (${payloadKind})`);

  if (!payload) {
    // No payload - execute command directly as agentTurn
    await executeAgentTurn(job, { kind: "agentTurn", message: job.command }, bot);
    return;
  }

  switch (payload.kind) {
    case "systemEvent":
      await executeSystemEvent(job, payload, bot);
      break;
    case "agentTurn":
      await executeAgentTurn(job, payload, bot);
      break;
    default:
      console.error(`[Cron] Unknown payload kind:`, (payload as Payload).kind);
  }
}

/**
 * Execute a system event job
 * Sends a predefined message to the chat
 */
async function executeSystemEvent(
  job: CronJob,
  payload: SystemEventPayload,
  bot: Bot
): Promise<void> {
  const { eventType, data } = payload;

  // Build message based on event type
  let message: string;
  switch (eventType) {
    case "dailyBriefing":
      message = "🌅 일일 브리핑 시간이야!";
      break;
    case "heartbeat":
      message = "💓 체크인 시간이야. 필요한 거 있어?";
      break;
    case "checkReminders":
      message = "⏰ 리마인더 체크 중...";
      break;
    case "custom":
      message = (data?.message as string) || "📢 알림";
      break;
    default:
      message = `📢 System Event: ${eventType}`;
  }

  try {
    await bot.api.sendMessage(job.chatId, message);
  } catch (error) {
    console.error(`[Cron] Failed to send system event to ${job.chatId}:`, error);
    throw error;
  }
}

/**
 * Execute an agent turn job
 * Calls Claude API with the message and sends the response to chat
 */
async function executeAgentTurn(
  job: CronJob,
  payload: AgentTurnPayload,
  bot: Bot
): Promise<void> {
  const { message: inputMessage, context } = payload;

  try {
    // Build a fresh conversation for this job (separate from main chat)
    const messages: Message[] = [
      {
        role: "user",
        content: inputMessage,
      },
    ];

    // Build system prompt with any additional context
    let systemPrompt = await buildSystemPrompt("sonnet" as ModelId);
    
    if (context) {
      systemPrompt += `\n\n[Scheduled Task Context]\n${JSON.stringify(context, null, 2)}`;
    }

    // Add job metadata to system prompt
    systemPrompt += `\n\n[Scheduled Job Info]
- Job Name: ${job.name || "unnamed"}
- Job ID: ${job.id}
- Run Count: ${(job.runCount || 0) + 1}
- This is a scheduled task, not a direct user message.`;

    // Call Claude API
    const response = await chat(messages, systemPrompt, "sonnet");

    // Send the response to the chat
    if (response && response.trim()) {
      // Split long messages (Telegram limit is 4096 characters)
      const maxLength = 4000;
      if (response.length <= maxLength) {
        await bot.api.sendMessage(job.chatId, response, {
          parse_mode: "Markdown",
        });
      } else {
        // Split into multiple messages
        const chunks = splitMessage(response, maxLength);
        for (const chunk of chunks) {
          await bot.api.sendMessage(job.chatId, chunk, {
            parse_mode: "Markdown",
          });
        }
      }
    }
  } catch (error) {
    console.error(`[Cron] Agent turn failed for job ${job.id}:`, error);
    
    // Optionally notify the user of failure
    try {
      await bot.api.sendMessage(
        job.chatId,
        `⚠️ 예약된 작업 "${job.name || job.id}" 실행 중 오류가 발생했어.`
      );
    } catch {
      // Ignore notification failure
    }
    
    throw error;
  }
}

/**
 * Split a long message into chunks
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (newline or space)
    let breakPoint = remaining.lastIndexOf("\n", maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

// ============================================================
// Module-level API for integration with bot.ts
// ============================================================

let scheduler: CronScheduler | null = null;

/**
 * Set the bot instance and create scheduler
 */
export function setCronBot(bot: Bot): void {
  botInstance = bot;
  scheduler = new CronScheduler(bot);
}

/**
 * Start the cron scheduler
 */
export function startCronScheduler(): void {
  if (!scheduler) {
    console.error("[Cron] Scheduler not initialized. Call setCronBot first.");
    return;
  }
  scheduler.start();
}

/**
 * Stop the cron scheduler
 */
export function stopCronScheduler(): void {
  if (scheduler) {
    scheduler.stop();
  }
}

/**
 * Get scheduler status
 */
export function isCronSchedulerRunning(): boolean {
  return scheduler?.isRunning() ?? false;
}

/**
 * Initialize and start the cron system
 * Call this from bot.ts during startup
 */
export async function initCronSystem(bot: Bot): Promise<void> {
  setCronBot(bot);
  startCronScheduler();
  console.log("[Cron] System initialized");
}

/**
 * Restore and start cron jobs on bot startup
 */
export async function restoreCronJobs(): Promise<void> {
  const jobs = await loadJobs();
  console.log(`[Cron] Restored ${jobs.length} job(s)`);
}

// ============================================================
// CRUD API for commands.ts
// ============================================================

/**
 * Create a new cron job
 */
export async function createCronJob(options: CreateJobOptions): Promise<CronJob> {
  return addJob({
    chatId: options.chatId,
    name: options.name,
    cronExpr: options.cronExpr,
    command: options.command,
    enabled: true,
    timezone: options.timezone || "Asia/Seoul",
    payload: options.payload,
    maxRuns: options.maxRuns,
  });
}

/**
 * Delete a cron job
 */
export async function deleteCronJob(id: string): Promise<boolean> {
  return removeJob(id);
}

/**
 * Toggle cron job enabled/disabled
 */
export async function toggleCronJob(id: string, enabled: boolean): Promise<boolean> {
  const result = await updateJob(id, { enabled });
  return result !== null;
}

/**
 * Get cron jobs for a specific chat
 */
export async function getCronJobs(chatId: number): Promise<CronJob[]> {
  return getJobsByChat(chatId);
}

/**
 * Get all cron jobs
 */
export async function getAllCronJobs(): Promise<CronJob[]> {
  return loadJobs();
}

/**
 * Get count of active (enabled) jobs
 */
export function getActiveJobCount(): number {
  // Synchronous version - returns cached count or 0
  // For actual count, use getAllCronJobs and filter
  return 0; // Placeholder - will be updated by scheduler
}

// ============================================================
// Default Cron Jobs
// ============================================================

const DEFAULT_CRON_JOBS = [
  {
    name: "daily_memory_save",
    cronExpr: "0 12 * * *", // 매일 12시
    command: "오늘 하루 동안 있었던 중요한 일들을 정리해서 MEMORY.md에 저장해줘. 새로운 정보, 대화 내용, 배운 것들 위주로.",
    timezone: "Asia/Seoul",
  },
];

/**
 * Ensure default cron jobs exist for a chat
 * Call this after onboarding or on /start
 */
export async function ensureDefaultCronJobs(chatId: number): Promise<void> {
  const existingJobs = await getJobsByChat(chatId);
  
  for (const defaultJob of DEFAULT_CRON_JOBS) {
    const exists = existingJobs.some(job => job.name === defaultJob.name);
    
    if (!exists) {
      await createCronJob({
        chatId,
        name: defaultJob.name,
        cronExpr: defaultJob.cronExpr,
        command: defaultJob.command,
        timezone: defaultJob.timezone,
      });
      console.log(`[Cron] Added default job: ${defaultJob.name} for chat ${chatId}`);
    }
  }
}
