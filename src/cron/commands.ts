/**
 * Cron 명령어 핸들러
 * AI가 tool로 호출할 수 있는 함수들
 */

import {
  createCronJob,
  deleteCronJob,
  toggleCronJob,
  getCronJobs,
  getAllCronJobs,
  getActiveJobCount,
} from "./scheduler.js";
import type { CronJob, CreateJobOptions } from "./types.js";

export type CronCommandResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

/**
 * cron job 추가
 */
export async function addCronJob(
  chatId: number,
  name: string,
  cronExpr: string,
  command: string,
  timezone?: string
): Promise<CronCommandResult> {
  try {
    const options: CreateJobOptions = {
      chatId,
      name,
      cronExpr,
      command,
      timezone,
    };
    
    const job = await createCronJob(options);

    return {
      success: true,
      message: `Cron job "${name}" 생성됨 (${cronExpr})`,
      data: job,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Job 생성 실패",
    };
  }
}

/**
 * cron job 삭제
 */
export async function removeCronJob(id: string): Promise<CronCommandResult> {
  const deleted = await deleteCronJob(id);

  if (deleted) {
    return {
      success: true,
      message: `Job ${id} 삭제됨`,
    };
  }

  return {
    success: false,
    message: `Job ${id}를 찾을 수 없음`,
  };
}

/**
 * cron job 활성화/비활성화
 */
export async function setCronJobEnabled(
  id: string,
  enabled: boolean
): Promise<CronCommandResult> {
  const updated = await toggleCronJob(id, enabled);

  if (updated) {
    return {
      success: true,
      message: `Job ${id} ${enabled ? "활성화" : "비활성화"}됨`,
    };
  }

  return {
    success: false,
    message: `Job ${id}를 찾을 수 없음`,
  };
}

/**
 * cron jobs 목록
 */
export async function listCronJobs(chatId?: number): Promise<CronCommandResult> {
  const jobs = chatId ? await getCronJobs(chatId) : await getAllCronJobs();

  if (jobs.length === 0) {
    return {
      success: true,
      message: "등록된 cron job이 없습니다.",
      data: [],
    };
  }

  const formatted = jobs.map((job: CronJob) => formatJob(job)).join("\n\n");

  return {
    success: true,
    message: `📋 Cron Jobs (${jobs.length}개)\n\n${formatted}`,
    data: jobs,
  };
}

/**
 * Job 포맷팅
 */
function formatJob(job: CronJob): string {
  const status = job.enabled ? "✅" : "⏸️";
  const lastRun = job.lastRun
    ? new Date(job.lastRun).toLocaleString("ko-KR", { timeZone: job.timezone })
    : "없음";

  return [
    `${status} **${job.name}** (${job.id})`,
    `   ⏰ ${job.cronExpr}`,
    `   📝 ${job.command.slice(0, 50)}${job.command.length > 50 ? "..." : ""}`,
    `   🔄 실행: ${job.runCount}회 | 마지막: ${lastRun}`,
  ].join("\n");
}

/**
 * 상태 요약
 */
export function getCronStatus(): CronCommandResult {
  const activeCount = getActiveJobCount();

  return {
    success: true,
    message: `🕐 Cron 시스템: ${activeCount}개 job 실행 중`,
    data: { activeCount },
  };
}
