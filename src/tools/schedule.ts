/**
 * Schedule-related tools (reminders, cron, heartbeat, briefing)
 */

import { getCurrentChatId } from "../session/state.js";
import {
  createReminder,
  deleteReminder,
  getReminders,
  parseTimeExpression,
} from "../reminders/index.js";
import {
  isCalendarConfigured,
  getEvents,
  addEvent,
  deleteEvent,
  formatEvent,
  parseDateExpression,
} from "../calendar/index.js";
import {
  setHeartbeatConfig,
  getHeartbeatConfig,
  disableHeartbeat,
  runHeartbeatNow,
} from "../heartbeat/index.js";
import {
  setBriefingConfig,
  getBriefingConfig,
  disableBriefing,
  sendBriefingNow,
} from "../briefing/index.js";
import {
  addCronJob,
  listCronJobs,
  removeCronJob,
  setCronJobEnabled,
  runCronJobNow,
  parseScheduleExpression,
} from "../cron/index.js";

// ============== 리마인더 ==============

export async function executeSetReminder(input: Record<string, unknown>): Promise<string> {
  const message = input.message as string;
  const timeExpr = input.time_expr as string;
  const chatId = getCurrentChatId();

  if (!chatId) {
    return "Error: No active chat session";
  }

  const scheduledTime = parseTimeExpression(timeExpr);
  if (!scheduledTime) {
    return `Error: Could not parse time expression "${timeExpr}". Try formats like "10분 후", "내일 9시", "오후 3시"`;
  }

  const reminder = await createReminder(chatId, message, scheduledTime);

  const timeStr = scheduledTime.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

  return `Reminder set! I'll remind you "${message}" at ${timeStr}. (ID: ${reminder.id})`;
}

export async function executeListReminders(): Promise<string> {
  const chatId = getCurrentChatId();

  if (!chatId) {
    return "Error: No active chat session";
  }

  const reminders = await getReminders(chatId);

  if (reminders.length === 0) {
    return "No active reminders.";
  }

  const list = reminders.map((r) => {
    const time = new Date(r.scheduledAt).toLocaleString("ko-KR", {
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    return `- [${r.id}] "${r.message}" at ${time}`;
  });

  return `Active reminders:\n${list.join("\n")}`;
}

export async function executeCancelReminder(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string;
  const success = await deleteReminder(id);

  if (success) {
    return `Reminder ${id} cancelled.`;
  } else {
    return `Reminder ${id} not found.`;
  }
}

// ============== 캘린더 ==============

export async function executeGetCalendarEvents(input: Record<string, unknown>): Promise<string> {
  const configured = await isCalendarConfigured();
  if (!configured) {
    return "Error: Google Calendar not configured. Ask user to set it up with /calendar_setup";
  }

  const dateRange = input.date_range as string;
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (dateRange) {
    case "today":
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    case "tomorrow":
      start = new Date(now);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    case "week":
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setDate(end.getDate() + 7);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      return "Error: Invalid date range";
  }

  const events = await getEvents(start, end);

  if (events.length === 0) {
    return `No events found for ${dateRange}.`;
  }

  const eventList = events.map((e) => {
    const formatted = formatEvent(e);
    return `- ${formatted} (ID: ${e.id})`;
  });

  const dateLabel = dateRange === "today" ? "오늘" : dateRange === "tomorrow" ? "내일" : "이번 주";
  return `${dateLabel} 일정:\n${eventList.join("\n")}`;
}

export async function executeAddCalendarEvent(input: Record<string, unknown>): Promise<string> {
  const configured = await isCalendarConfigured();
  if (!configured) {
    return "Error: Google Calendar not configured. Ask user to set it up with /calendar_setup";
  }

  const title = input.title as string;
  const timeExpr = input.time_expr as string;
  const description = input.description as string | undefined;

  const parsed = parseDateExpression(timeExpr);
  if (!parsed) {
    return `Error: Could not parse time "${timeExpr}". Try formats like "내일 오후 3시", "모레 오전 10시"`;
  }

  const event = await addEvent(title, parsed.start, parsed.end, description);

  const timeStr = parsed.start.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

  return `Event created: "${title}" at ${timeStr}`;
}

export async function executeDeleteCalendarEvent(input: Record<string, unknown>): Promise<string> {
  const configured = await isCalendarConfigured();
  if (!configured) {
    return "Error: Google Calendar not configured.";
  }

  const eventId = input.event_id as string;
  const success = await deleteEvent(eventId);

  if (success) {
    return `Event deleted.`;
  } else {
    return `Event not found or could not be deleted.`;
  }
}

// ============== Heartbeat ==============

export async function executeControlHeartbeat(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const action = input.action as string;
  const intervalMinutes = (input.interval_minutes as number) || 30;

  switch (action) {
    case "on": {
      const interval = Math.max(5, Math.min(1440, intervalMinutes));
      await setHeartbeatConfig(chatId, true, interval);
      return `Heartbeat enabled! Checking every ${interval} minutes.`;
    }
    case "off": {
      await disableHeartbeat(chatId);
      return "Heartbeat disabled.";
    }
    case "status": {
      const config = await getHeartbeatConfig(chatId);
      if (!config || !config.enabled) {
        return "Heartbeat is currently disabled.";
      }
      const intervalMin = Math.floor(config.intervalMs / 60000);
      const lastCheck = new Date(config.lastCheckAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      return `Heartbeat is enabled. Interval: ${intervalMin} minutes. Last check: ${lastCheck}`;
    }
    default:
      return "Error: Invalid action";
  }
}

export async function executeRunHeartbeatCheck(): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const messageSent = await runHeartbeatNow(chatId);
  if (messageSent) {
    return "Heartbeat check complete. A notification was sent.";
  } else {
    return "Heartbeat check complete. Nothing to report.";
  }
}

// ============== Briefing ==============

export async function executeControlBriefing(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const action = input.action as string;
  const time = (input.time as string) || "08:00";
  const city = (input.city as string) || "Seoul";

  switch (action) {
    case "on": {
      await setBriefingConfig(chatId, true, time, city);
      return `Daily briefing enabled! Will send at ${time} (${city}).`;
    }
    case "off": {
      await disableBriefing(chatId);
      return "Daily briefing disabled.";
    }
    case "status": {
      const config = await getBriefingConfig(chatId);
      if (!config || !config.enabled) {
        return "Daily briefing is currently disabled.";
      }
      return `Daily briefing is enabled. Time: ${config.time}, City: ${config.city}`;
    }
    default:
      return "Error: Invalid action";
  }
}

export async function executeSendBriefingNow(): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  await sendBriefingNow(chatId);
  return "Briefing sent!";
}

// ============== Cron ==============

export async function executeAddCron(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const name = input.name as string;
  const scheduleExpr = input.schedule as string;
  const command = (input.payload as string) || (input.command as string) || "";

  if (!name || !scheduleExpr) {
    return "Error: name and schedule are required";
  }

  // 스케줄 파싱 (cron expression 또는 한국어)
  const parsed = parseScheduleExpression(scheduleExpr);
  const cronExpr = parsed ? parsed.expression : scheduleExpr;

  try {
    const result = await addCronJob(chatId, name, cronExpr, command);
    
    if (!result.success) {
      return `Error: ${result.message}`;
    }
    
    const job = result.data as { id: string; nextRun?: string };
    const nextRunStr = job?.nextRun 
      ? new Date(job.nextRun).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      : "계산 중...";

    return `Cron job created! ⏰
ID: ${job?.id || "unknown"}
Name: ${name}
Schedule: ${cronExpr}
Next run: ${nextRunStr}`;
  } catch (error) {
    return `Error creating cron job: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function executeListCrons(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const showDisabled = (input.show_disabled as boolean) !== false;
  const result = await listCronJobs(chatId);

  if (!result.success) {
    return `Error: ${result.message}`;
  }

  const jobs = (result.data as Array<{ id: string; name: string; enabled: boolean; cronExpr: string; nextRun?: string }>) || [];
  const filteredJobs = showDisabled ? jobs : jobs.filter((j) => j.enabled);

  if (filteredJobs.length === 0) {
    return showDisabled 
      ? "No cron jobs found for this chat."
      : "No active cron jobs. Use list_crons with show_disabled=true to see all.";
  }

  const lines = filteredJobs.map((job) => {
    const status = job.enabled ? "✅" : "⏸️";
    const scheduleStr = job.cronExpr;
    
    const nextRun = job.nextRun
      ? new Date(job.nextRun).toLocaleString("ko-KR", { 
          month: "short", 
          day: "numeric", 
          hour: "2-digit", 
          minute: "2-digit",
          timeZone: "Asia/Seoul"
        })
      : "N/A";

    return `${status} [${job.id.slice(0, 8)}] ${job.name || "(unnamed)"}
   Schedule: ${scheduleStr}
   Next run: ${nextRun}`;
  });

  return `Cron jobs (${filteredJobs.length}):\n\n${lines.join("\n\n")}`;
}

export async function executeRemoveCron(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const id = input.id as string;
  if (!id) {
    return "Error: Cron job ID is required";
  }

  const result = await removeCronJob(id);
  if (result.success) {
    return `Cron job ${id} deleted.`;
  } else {
    return `Cron job ${id} not found.`;
  }
}

export async function executeToggleCron(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const id = input.id as string;
  const enabled = input.enabled as boolean;

  if (!id || enabled === undefined) {
    return "Error: Both id and enabled are required";
  }

  const result = await setCronJobEnabled(id, enabled);
  if (result.success) {
    const status = enabled ? "enabled ✅" : "disabled ⏸️";
    return `Cron job ${id} is now ${status}.`;
  } else {
    return `Cron job ${id} not found.`;
  }
}

export async function executeRunCron(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const id = input.id as string;
  if (!id) {
    return "Error: Cron job ID is required";
  }

  const success = await runCronJobNow(id);
  if (success) {
    return `Cron job ${id} executed! 🚀`;
  } else {
    return `Error: Cron job ${id} not found.`;
  }
}
