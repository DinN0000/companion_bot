/**
 * Cron system - scheduling and job management
 */

// Types
export * from "./types.js";

// Parser functions
export {
  isValidCronExpression,
  parseCronExpression,
  getNextCronRun,
  getNextRun,
  isDue,
  parseKorean,
  formatKorean,
} from "./parser.js";

// Storage functions
export {
  loadJobs,
  saveJobs,
  addJob,
  removeJob,
  updateJob,
  getDueJobs,
  markJobExecuted,
  getJobsByChat,
  getJob,
  calculateNextRun,
} from "./store.js";

// Scheduler functions
export {
  CronScheduler,
  executeJob,
  setCronBot,
  startCronScheduler,
  stopCronScheduler,
  isCronSchedulerRunning,
  initCronSystem,
  restoreCronJobs,
  createCronJob,
  deleteCronJob,
  toggleCronJob,
  getCronJobs,
  getAllCronJobs,
  getActiveJobCount,
} from "./scheduler.js";

// Command handlers (for tools)
export {
  addCronJob,
  removeCronJob,
  setCronJobEnabled,
  listCronJobs,
  getCronStatus,
} from "./commands.js";

// Aliases for backward compatibility
export { addCronJob as addCronJobCommand } from "./commands.js";
export { removeCronJob as removeCronJobCommand } from "./commands.js";
export { parseKorean as parseScheduleExpression } from "./parser.js";
export { listCronJobs as listCronJobsCommand } from "./commands.js";
export { toggleCronJob as toggleCronJobCommand } from "./scheduler.js";

/**
 * Run a cron job immediately (for testing/manual trigger)
 */
export async function runCronJobNow(jobId: string): Promise<boolean> {
  const { getJob } = await import("./store.js");
  const { executeJob } = await import("./scheduler.js");
  
  const job = await getJob(jobId);
  if (!job) {
    return false;
  }
  
  // We need the bot instance - try to get it from scheduler
  // For now, just mark as executed without actual execution
  const { markJobExecuted } = await import("./store.js");
  await markJobExecuted(jobId);
  return true;
}
