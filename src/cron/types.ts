/**
 * Cron 시스템 타입 정의
 */

// ============================================================
// Schedule 타입들
// ============================================================

export type AtSchedule = {
  kind: "at";
  atMs: number;
  datetime?: string;  // ISO string (for display)
};

export type EverySchedule = {
  kind: "every";
  everyMs: number;
  intervalMs?: number; // alias for everyMs
  startMs?: number;
  startAt?: string;   // ISO string
};

export type CronSchedule = {
  kind: "cron";
  expression: string;
  timezone?: string;
};

export type Schedule = AtSchedule | EverySchedule | CronSchedule;

// ============================================================
// Payload 타입들
// ============================================================

export type SystemEventPayload = {
  kind: "systemEvent";
  eventType: "dailyBriefing" | "heartbeat" | "checkReminders" | "custom";
  data?: Record<string, unknown>;
};

export type AgentTurnPayload = {
  kind: "agentTurn";
  message: string;
  context?: Record<string, unknown>;
};

export type Payload = SystemEventPayload | AgentTurnPayload;

// ============================================================
// CronJob 타입들
// ============================================================

export type CronJob = {
  id: string;
  chatId: number;
  name: string;
  cronExpr: string;           // cron expression (e.g., "0 9 * * *")
  command: string;            // 실행할 명령/메시지
  enabled: boolean;
  createdAt: string;          // ISO string
  lastRun?: string;           // ISO string
  nextRun?: string;           // ISO string (계산됨)
  runCount: number;
  timezone: string;           // default: "Asia/Seoul"
  
  // Optional fields
  schedule?: Schedule;        // parsed schedule
  payload?: Payload;          // execution payload
  maxRuns?: number;           // max number of runs (undefined = unlimited)
};

export type NewCronJob = Omit<CronJob, "id" | "createdAt" | "runCount" | "lastRun" | "nextRun"> & {
  runCount?: number;
};

export type CreateJobOptions = {
  chatId: number;
  name: string;
  cronExpr: string;
  command: string;
  timezone?: string;
  payload?: Payload;
  maxRuns?: number;
};

// ============================================================
// Store 타입들
// ============================================================

export type CronStore = {
  version?: number;
  jobs: CronJob[];
};

// Alias for backwards compatibility
export type CronJobStore = CronStore;

// ============================================================
// Parser 타입들
// ============================================================

export type CronFieldType = "wildcard" | "value" | "range" | "list" | "step";

export type CronField = {
  type: CronFieldType;
  values: number[];
};

export type ParsedCronExpression = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  original: string;
};
