/**
 * Cron Job Store
 *
 * Persists and manages cron jobs.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { getWorkspacePath } from "../workspace/paths.js";
import type { CronJob, CronStore, NewCronJob, Schedule } from "./types.js";

const CRON_FILE = "cron-jobs.json";
const STORE_VERSION = 1;

function getCronFilePath(): string {
  return path.join(getWorkspacePath(), CRON_FILE);
}

/**
 * Generate a unique ID without uuid dependency
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Load all cron jobs from storage
 */
export async function loadJobs(): Promise<CronJob[]> {
  try {
    const data = await fs.readFile(getCronFilePath(), "utf-8");
    const store: CronStore = JSON.parse(data);
    return store.jobs || [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    console.error("[Cron] Failed to load jobs:", error);
    return [];
  }
}

/**
 * Save all cron jobs to storage
 */
export async function saveJobs(jobs: CronJob[]): Promise<void> {
  const store: CronStore = {
    version: STORE_VERSION,
    jobs,
  };
  await fs.writeFile(getCronFilePath(), JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Add a new cron job
 */
export async function addJob(newJob: NewCronJob): Promise<CronJob> {
  const jobs = await loadJobs();
  
  const job: CronJob = {
    ...newJob,
    id: generateId(),
    createdAt: new Date().toISOString(),
    runCount: newJob.runCount ?? 0,
  };
  
  // Calculate initial nextRun
  if (job.schedule) {
    job.nextRun = calculateNextRun(job.schedule);
  } else {
    // Use cronExpr to calculate next run
    job.nextRun = calculateCronNextRun(job.cronExpr, job.timezone);
  }
  
  jobs.push(job);
  await saveJobs(jobs);
  
  return job;
}

/**
 * Remove a cron job by ID
 */
export async function removeJob(jobId: string): Promise<boolean> {
  const jobs = await loadJobs();
  const index = jobs.findIndex((j) => j.id === jobId);
  
  if (index === -1) {
    return false;
  }
  
  jobs.splice(index, 1);
  await saveJobs(jobs);
  return true;
}

/**
 * Update a cron job
 */
export async function updateJob(jobId: string, updates: Partial<CronJob>): Promise<CronJob | null> {
  const jobs = await loadJobs();
  const index = jobs.findIndex((j) => j.id === jobId);
  
  if (index === -1) {
    return null;
  }
  
  jobs[index] = { ...jobs[index], ...updates };
  await saveJobs(jobs);
  return jobs[index];
}

/**
 * Get jobs that are due to run
 */
export async function getDueJobs(): Promise<CronJob[]> {
  const jobs = await loadJobs();
  const now = new Date();
  
  return jobs.filter((job) => {
    if (!job.enabled) return false;
    if (!job.nextRun) return false;
    
    // Check if we've exceeded max runs
    if (job.maxRuns !== undefined && (job.runCount || 0) >= job.maxRuns) {
      return false;
    }
    
    return new Date(job.nextRun) <= now;
  });
}

/**
 * Mark a job as executed and update nextRun
 */
export async function markJobExecuted(jobId: string): Promise<void> {
  const jobs = await loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  
  if (!job) return;
  
  job.lastRun = new Date().toISOString();
  job.runCount = (job.runCount || 0) + 1;
  
  // Check if job should be disabled (one-time jobs)
  if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
    job.enabled = false;
    job.nextRun = undefined;
  } else {
    // Calculate next run
    if (job.schedule) {
      job.nextRun = calculateNextRun(job.schedule);
    } else {
      job.nextRun = calculateCronNextRun(job.cronExpr, job.timezone);
    }
  }
  
  await saveJobs(jobs);
}

/**
 * Calculate the next run time for a schedule
 */
export function calculateNextRun(schedule: Schedule): string | undefined {
  const now = new Date();
  
  switch (schedule.kind) {
    case "at": {
      const targetTime = new Date(schedule.atMs);
      // If in the past, no next run
      return targetTime > now ? targetTime.toISOString() : undefined;
    }
    
    case "every": {
      const intervalMs = schedule.everyMs || schedule.intervalMs || 60000;
      const startAt = schedule.startMs ? new Date(schedule.startMs) : now;
      if (startAt > now) {
        return startAt.toISOString();
      }
      // Next interval from now
      const nextRun = new Date(now.getTime() + intervalMs);
      return nextRun.toISOString();
    }
    
    case "cron": {
      return calculateCronNextRun(schedule.expression, schedule.timezone);
    }
  }
}

/**
 * Parse and calculate next run for cron expression
 * Supports: minute hour day month weekday
 */
function calculateCronNextRun(expression: string, _timezone?: string): string | undefined {
  // Basic implementation - for production, use node-cron or cron-parser
  const parts = expression.split(" ");
  if (parts.length !== 5) {
    console.error("[Cron] Invalid cron expression:", expression);
    return undefined;
  }
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const now = new Date();
  
  // Simple case: specific minute and hour (e.g., "0 9 * * *" = 9:00 every day)
  if (minute !== "*" && hour !== "*" && dayOfMonth === "*" && month === "*") {
    const targetMinute = parseInt(minute, 10);
    const targetHour = parseInt(hour, 10);
    
    const next = new Date(now);
    next.setHours(targetHour, targetMinute, 0, 0);
    
    // If already passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    // Check day of week constraint
    if (dayOfWeek !== "*") {
      const targetDays = parseCronField(dayOfWeek, 0, 6);
      while (!targetDays.includes(next.getDay())) {
        next.setDate(next.getDate() + 1);
      }
    }
    
    return next.toISOString();
  }
  
  // Default: next minute for complex expressions
  const next = new Date(now.getTime() + 60000);
  next.setSeconds(0, 0);
  return next.toISOString();
}

/**
 * Parse cron field like "1,3,5" or "1-5" into array of numbers
 */
function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }
  
  const values: number[] = [];
  const parts = field.split(",");
  
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
    } else {
      values.push(parseInt(part, 10));
    }
  }
  
  return values;
}

/**
 * Get all jobs for a specific chat
 */
export async function getJobsByChat(chatId: number | string): Promise<CronJob[]> {
  const jobs = await loadJobs();
  const numericChatId = typeof chatId === "string" ? parseInt(chatId, 10) : chatId;
  return jobs.filter((j) => j.chatId === numericChatId);
}

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<CronJob | undefined> {
  const jobs = await loadJobs();
  return jobs.find((j) => j.id === jobId);
}
