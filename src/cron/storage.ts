/**
 * Cron Job 저장소
 */

import * as fs from "fs/promises";
import * as path from "path";
import { getWorkspacePath } from "../workspace/index.js";
import type { CronJob, CronStore } from "./types.js";

function getCronPath(): string {
  return path.join(getWorkspacePath(), "cron-jobs.json");
}

export async function loadStore(): Promise<CronStore> {
  try {
    const data = await fs.readFile(getCronPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return { jobs: [] };
  }
}

export async function saveStore(store: CronStore): Promise<void> {
  await fs.writeFile(getCronPath(), JSON.stringify(store, null, 2));
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function getJob(id: string): Promise<CronJob | null> {
  const store = await loadStore();
  return store.jobs.find((j) => j.id === id) || null;
}

export async function getJobsByChat(chatId: number): Promise<CronJob[]> {
  const store = await loadStore();
  return store.jobs.filter((j) => j.chatId === chatId);
}

export async function getAllJobs(): Promise<CronJob[]> {
  const store = await loadStore();
  return store.jobs;
}

export async function createJob(job: CronJob): Promise<void> {
  const store = await loadStore();
  store.jobs.push(job);
  await saveStore(store);
}

export async function updateJob(id: string, updates: Partial<CronJob>): Promise<boolean> {
  const store = await loadStore();
  const index = store.jobs.findIndex((j) => j.id === id);
  if (index === -1) return false;
  
  store.jobs[index] = { ...store.jobs[index], ...updates };
  await saveStore(store);
  return true;
}

export async function deleteJob(id: string): Promise<boolean> {
  const store = await loadStore();
  const index = store.jobs.findIndex((j) => j.id === id);
  if (index === -1) return false;
  
  store.jobs.splice(index, 1);
  await saveStore(store);
  return true;
}
