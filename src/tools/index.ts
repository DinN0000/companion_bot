import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { MODELS, type ModelId } from "../ai/claude.js";
import { getCurrentChatId, setModel, getModel } from "../session/state.js";
import {
  getWorkspacePath,
  saveWorkspaceFile,
  appendToMemory,
  deleteBootstrap,
} from "../workspace/index.js";
import { getSecret } from "../config/secrets.js";
import {
  createReminder,
  deleteReminder,
  getReminders,
  parseTimeExpression,
} from "../reminders/index.js";
import {
  isCalendarConfigured,
  getTodayEvents,
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
  spawnAgent,
  listAgents,
  cancelAgent,
} from "../agents/index.js";
import {
  addCronJob,
  listCronJobs,
  removeCronJob,
  setCronJobEnabled,
  runCronJobNow,
  parseScheduleExpression,
} from "../cron/index.js";
import * as cheerio from "cheerio";

const execAsync = promisify(exec);

// ============== 세션 관리 ==============
interface ProcessSession {
  id: string;
  pid: number;
  command: string;
  cwd: string;
  startTime: Date;
  endTime?: Date;
  exitCode?: number | null;
  outputBuffer: string[];
  process: ChildProcess;
  status: "running" | "completed" | "killed" | "error";
}

// 메모리에 세션 저장
const sessions = new Map<string, ProcessSession>();

// Output buffer 최대 크기 (라인 수)
const MAX_OUTPUT_LINES = 1000;

function appendOutput(session: ProcessSession, data: string) {
  const lines = data.split("\n");
  session.outputBuffer.push(...lines);
  // 버퍼 크기 제한
  if (session.outputBuffer.length > MAX_OUTPUT_LINES) {
    session.outputBuffer = session.outputBuffer.slice(-MAX_OUTPUT_LINES);
  }
}

// 홈 디렉토리
const home = process.env.HOME || "";

// 허용된 디렉토리 (보안을 위해 제한)
function getAllowedPaths(): string[] {
  return [
    path.join(home, "Documents"),
    path.join(home, "projects"),
    getWorkspacePath(), // 워크스페이스 경로 추가
  ];
}

// 위험한 파일 패턴
const DANGEROUS_PATTERNS = [
  /\.bashrc$/,
  /\.zshrc$/,
  /\.bash_profile$/,
  /\.profile$/,
  /\.ssh\//,
  /\.git\/hooks\//,
  /\.git\/config$/,
  /\.env$/,
  /\.npmrc$/,
];

function isPathAllowed(targetPath: string): boolean {
  try {
    const resolved = path.resolve(targetPath);

    // 위험한 파일 패턴 차단
    if (DANGEROUS_PATTERNS.some(p => p.test(resolved))) {
      return false;
    }

    // 심볼릭 링크 해제하여 실제 경로 확인
    let realPath: string;
    try {
      realPath = fsSync.realpathSync(resolved);
    } catch {
      // 파일이 아직 없으면 (write_file) 부모 디렉토리 확인
      const parentDir = path.dirname(resolved);
      try {
        realPath = path.join(fsSync.realpathSync(parentDir), path.basename(resolved));
      } catch {
        realPath = resolved;
      }
    }

    const allowedPaths = getAllowedPaths();

    // 정확한 경로 구분자로 비교 (startsWith만으로는 ~/DocumentsEvil 같은 경로 통과)
    return allowedPaths.some((allowed) => {
      const normalizedAllowed = path.resolve(allowed);
      return realPath === normalizedAllowed ||
             realPath.startsWith(normalizedAllowed + path.sep);
    });
  } catch {
    return false;
  }
}

// Tool 정의 (Claude API 형식)
export const tools = [
  {
    name: "read_file",
    description: "Read the contents of a file. Use this to view code, documents, or any text file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits instead of rewriting the entire file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to edit",
        },
        oldText: {
          type: "string",
          description: "Exact text to find and replace (must match exactly including whitespace)",
        },
        newText: {
          type: "string",
          description: "New text to replace the old text with",
        },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories in a given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the directory to list",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: `Run a shell command. Use with caution. Only for safe commands like git status, npm run, etc.

When background=true:
- Command runs in detached mode
- Returns a session ID immediately
- Use list_sessions, get_session_log, kill_session to manage
- Useful for long-running commands (npm run dev, servers, etc.)`,
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to run",
        },
        cwd: {
          type: "string",
          description: "The working directory to run the command in (optional)",
        },
        background: {
          type: "boolean",
          description: "Run in background and return session ID (default: false)",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds for foreground commands (default: 30)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "list_sessions",
    description: "List all background command sessions. Shows running and recently completed sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["all", "running", "completed"],
          description: "Filter by status (default: all)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_session_log",
    description: "Get the output log of a background session.",
    input_schema: {
      type: "object" as const,
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to get logs from",
        },
        tail: {
          type: "number",
          description: "Number of lines from the end (default: 50)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "kill_session",
    description: "Kill a running background session.",
    input_schema: {
      type: "object" as const,
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to kill",
        },
        signal: {
          type: "string",
          enum: ["SIGTERM", "SIGKILL", "SIGINT"],
          description: "Signal to send (default: SIGTERM)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "change_model",
    description: `Change the AI model for this conversation. Use this when the user asks to switch models, or when you determine a different model would be better suited for the task.

Available models:
- "sonnet": Claude Sonnet 4 - Balanced performance and cost (default)
- "opus": Claude Opus 4 - Most capable, best for complex reasoning and coding
- "haiku": Claude Haiku 3.5 - Fastest and cheapest, good for simple tasks

Guidelines:
- Use opus for complex coding, architecture decisions, or deep analysis
- Use haiku for simple questions, quick lookups, or casual chat
- Use sonnet for general tasks (default)`,
    input_schema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string",
          enum: ["sonnet", "opus", "haiku"],
          description: "The model to switch to",
        },
        reason: {
          type: "string",
          description: "Brief reason for the model change",
        },
      },
      required: ["model"],
    },
  },
  {
    name: "save_memory",
    description: "Save important information about the user or conversation to long-term memory. Use this when you learn something new about the user that should be remembered.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The information to remember",
        },
        category: {
          type: "string",
          enum: ["user_info", "preference", "event", "project", "other"],
          description: "Category of the memory",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "save_persona",
    description: "Save persona settings after onboarding. Use this when the user has defined their companion's identity, soul, and shared their own info.",
    input_schema: {
      type: "object" as const,
      properties: {
        identity: {
          type: "string",
          description: "Content for IDENTITY.md - name, vibe, emoji, intro",
        },
        soul: {
          type: "string",
          description: "Content for SOUL.md - personality, style, values, interests",
        },
        user: {
          type: "string",
          description: "Content for USER.md - user info, preferences",
        },
      },
      required: ["identity", "soul", "user"],
    },
  },
  {
    name: "get_weather",
    description: "Get current weather for a location. Use when the user asks about weather.",
    input_schema: {
      type: "object" as const,
      properties: {
        city: {
          type: "string",
          description: "City name (e.g., 'Seoul', 'Tokyo', 'New York')",
        },
        country: {
          type: "string",
          description: "Country code (optional, e.g., 'KR', 'JP', 'US')",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "set_reminder",
    description: `Set a reminder for the user. Use when the user asks to be reminded about something.

Examples of time expressions you can parse:
- "10분 후", "30분 뒤" (in X minutes)
- "1시간 후", "2시간 뒤" (in X hours)
- "내일 9시", "내일 오후 3시" (tomorrow at X)
- "오후 5시", "오늘 저녁 7시" (today at X)`,
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The reminder message to send",
        },
        time_expr: {
          type: "string",
          description: "Time expression in Korean (e.g., '10분 후', '내일 9시', '오후 3시')",
        },
      },
      required: ["message", "time_expr"],
    },
  },
  {
    name: "list_reminders",
    description: "List all active reminders for the current user.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_reminder",
    description: "Cancel a reminder by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The reminder ID to cancel",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_calendar_events",
    description: `Get calendar events. Use when the user asks about their schedule.

Examples:
- "오늘 일정 뭐야?" → date_range: "today"
- "내일 스케줄 알려줘" → date_range: "tomorrow"
- "이번 주 일정" → date_range: "week"`,
    input_schema: {
      type: "object" as const,
      properties: {
        date_range: {
          type: "string",
          enum: ["today", "tomorrow", "week"],
          description: "The date range to query",
        },
      },
      required: ["date_range"],
    },
  },
  {
    name: "add_calendar_event",
    description: `Add a new calendar event. Use when the user wants to schedule something.

Examples:
- "내일 3시에 회의 잡아줘" → title: "회의", time_expr: "내일 오후 3시"
- "모레 오전 10시 치과" → title: "치과", time_expr: "모레 오전 10시"`,
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Event title",
        },
        time_expr: {
          type: "string",
          description: "Time expression in Korean (e.g., '내일 오후 3시', '모레 오전 10시')",
        },
        description: {
          type: "string",
          description: "Optional event description",
        },
      },
      required: ["title", "time_expr"],
    },
  },
  {
    name: "delete_calendar_event",
    description: "Delete a calendar event by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The event ID to delete",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "control_heartbeat",
    description: `Control the heartbeat feature. Heartbeat periodically checks a checklist and notifies the user if something needs attention.

Use this when the user says things like:
- "하트비트 켜줘/꺼줘" (turn on/off)
- "10분마다 체크해줘" (set interval)
- "하트비트 상태 알려줘" (check status)`,
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["on", "off", "status"],
          description: "Action to perform",
        },
        interval_minutes: {
          type: "number",
          description: "Check interval in minutes (5-1440). Only used with 'on' action.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "run_heartbeat_check",
    description: "Run heartbeat check immediately. Use when user asks to check now.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "control_briefing",
    description: `Control the daily briefing feature. Sends weather and schedule every morning.

Use this when the user says things like:
- "브리핑 켜줘/꺼줘" (turn on/off)
- "아침 9시에 브리핑 해줘" (set time)
- "브리핑 상태" (check status)`,
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["on", "off", "status"],
          description: "Action to perform",
        },
        time: {
          type: "string",
          description: "Time in HH:MM format (e.g., '08:00', '09:30'). Only used with 'on' action.",
        },
        city: {
          type: "string",
          description: "City for weather (e.g., 'Seoul', 'Tokyo'). Only used with 'on' action.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "send_briefing_now",
    description: "Send briefing immediately. Use when user asks for briefing right now.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // ============== Sub-Agent 도구 ==============
  {
    name: "spawn_agent",
    description: `Create a sub-agent to handle a complex or time-consuming task independently.

The sub-agent will:
- Run in the background with its own Claude API context
- Complete the task independently
- Report results back to this chat when done

Use this for:
- Tasks that require deep focus or analysis
- Long-running research or summarization
- Work that can be done in parallel while you handle other things

Example: "서브에이전트한테 이 코드 분석 시켜줘"`,
    input_schema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "Detailed description of the task for the sub-agent",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "list_agents",
    description: "List all sub-agents and their status (running, completed, failed, cancelled).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_agent",
    description: "Cancel a running sub-agent by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        agent_id: {
          type: "string",
          description: "The sub-agent ID to cancel",
        },
      },
      required: ["agent_id"],
    },
  },
  // ============== 웹 검색/가져오기 ==============
  {
    name: "web_search",
    description: `Search the web using Brave Search API. Use when the user asks to search for information online.

Examples:
- "최신 뉴스 검색해줘" → query: "최신 뉴스"
- "React 19 새로운 기능" → query: "React 19 new features"`,
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        count: {
          type: "number",
          description: "Number of results to return (default: 5, max: 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: `Fetch and extract readable content from a URL. Use when you need to read the content of a web page.

Examples:
- "이 링크 내용 요약해줘" → url: "https://..."
- "이 기사 읽어줘" → url: "https://..."`,
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return (default: 5000)",
        },
      },
      required: ["url"],
    },
  },
  // ============== Cron 도구 ==============
  {
    name: "add_cron",
    description: `Create a scheduled cron job. Use when the user wants to schedule recurring tasks.

Schedule formats:
- Cron expression: "0 9 * * *" (9AM daily), "0 9 * * 1-5" (weekdays 9AM)
- Korean: "매일 아침 9시", "평일 오후 3시", "매주 월요일 10시"
- Interval: "30분마다", "2시간마다"
- One-time: "내일 오전 9시에", "2024-12-25 10:00"

Examples:
- "매일 아침 9시에 뉴스 알려줘" → name: "뉴스", schedule: "매일 아침 9시", payload: { kind: "agentTurn", message: "오늘 뉴스 요약해줘" }
- "평일 오후 6시에 퇴근 알림" → name: "퇴근알림", schedule: "0 18 * * 1-5", payload: { kind: "agentTurn", message: "퇴근 시간이에요!" }`,
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Human-readable name for the cron job",
        },
        schedule: {
          type: "string",
          description: "Cron expression or Korean time expression (e.g., '0 9 * * *', '매일 아침 9시')",
        },
        payload: {
          type: "object",
          description: "Payload to execute. Use { kind: 'agentTurn', message: '...' } for agent messages",
          properties: {
            kind: {
              type: "string",
              enum: ["agentTurn", "systemEvent"],
            },
            message: { type: "string" },
            eventType: { type: "string" },
            data: { type: "object" },
            context: { type: "object" },
          },
          required: ["kind"],
        },
      },
      required: ["name", "schedule", "payload"],
    },
  },
  {
    name: "list_crons",
    description: "List all cron jobs for the current chat. Shows id, name, schedule, enabled status, and next run time.",
    input_schema: {
      type: "object" as const,
      properties: {
        show_disabled: {
          type: "boolean",
          description: "Include disabled jobs in the list (default: true)",
        },
      },
      required: [],
    },
  },
  {
    name: "remove_cron",
    description: "Delete a cron job by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The cron job ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "toggle_cron",
    description: "Enable or disable a cron job.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The cron job ID to toggle",
        },
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) the job",
        },
      },
      required: ["id", "enabled"],
    },
  },
  {
    name: "run_cron",
    description: "Run a cron job immediately, regardless of its schedule. Useful for testing or manual triggers.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The cron job ID to run immediately",
        },
      },
      required: ["id"],
    },
  },
];

// Tool 실행 함수
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const filePath = input.path as string;
        if (!isPathAllowed(filePath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }
        const content = await fs.readFile(filePath, "utf-8");
        return content;
      }

      case "write_file": {
        const filePath = input.path as string;
        const content = input.content as string;
        if (!isPathAllowed(filePath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return `File written successfully: ${filePath}`;
      }

      case "edit_file": {
        const filePath = input.path as string;
        const oldText = input.oldText as string;
        const newText = input.newText as string;

        if (!isPathAllowed(filePath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }

        // 파일 읽기
        let content: string;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch (error) {
          return `Error: Could not read file "${filePath}". ${error instanceof Error ? error.message : String(error)}`;
        }

        // oldText 찾기
        const index = content.indexOf(oldText);
        if (index === -1) {
          return `Error: oldText not found in file. Make sure the text matches exactly (including whitespace).`;
        }

        // 첫 번째만 교체
        const newContent = content.slice(0, index) + newText + content.slice(index + oldText.length);

        // 저장
        await fs.writeFile(filePath, newContent, "utf-8");
        return `File edited successfully: ${filePath}`;
      }

      case "list_directory": {
        const dirPath = input.path as string;
        if (!isPathAllowed(dirPath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const list = entries.map((e) =>
          `${e.isDirectory() ? "📁" : "📄"} ${e.name}`
        );
        return list.join("\n");
      }

      case "run_command": {
        const command = input.command as string;
        const cwd = (input.cwd as string) || path.join(home, "Documents");
        const background = (input.background as boolean) || false;
        const timeout = ((input.timeout as number) || 30) * 1000;

        // 화이트리스트 방식: 허용된 명령어만 실행
        const ALLOWED_COMMANDS = [
          "git", "npm", "npx", "node", "ls", "pwd", "cat", "head", "tail",
          "grep", "find", "wc", "sort", "uniq", "diff", "echo", "date",
          "which", "env", "printenv"
        ];

        // 명령어 체이닝/치환 차단 (;, &&, ||, |, `, $(), ${})
        if (/[;&|`]|\$\(|\$\{/.test(command)) {
          return `Error: Command chaining and substitution not allowed.`;
        }

        // 첫 번째 명령어 추출
        const parts = command.trim().split(/\s+/);
        const cmd = parts[0];

        if (!ALLOWED_COMMANDS.includes(cmd)) {
          return `Error: Command '${cmd}' not in allowed list. Allowed: ${ALLOWED_COMMANDS.join(", ")}`;
        }

        // 위험한 인자 차단
        const dangerousArgs = ["--force", "-rf", "--hard", "--no-preserve-root"];
        if (dangerousArgs.some(arg => parts.includes(arg))) {
          return `Error: Dangerous argument detected.`;
        }

        // 환경 변수는 필요한 것만 화이트리스트로 전달 (민감 정보 노출 방지)
        const safeEnv: Record<string, string> = {
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "",
          USER: process.env.USER || "",
          LANG: process.env.LANG || "en_US.UTF-8",
          TERM: process.env.TERM || "xterm",
        };

        // Background 실행
        if (background) {
          const sessionId = randomUUID().slice(0, 8);
          
          const child = spawn("sh", ["-c", command], {
            cwd,
            env: safeEnv,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });

          const session: ProcessSession = {
            id: sessionId,
            pid: child.pid!,
            command,
            cwd,
            startTime: new Date(),
            outputBuffer: [],
            process: child,
            status: "running",
          };

          // stdout/stderr 캡처
          child.stdout?.on("data", (data: Buffer) => {
            appendOutput(session, data.toString());
          });
          child.stderr?.on("data", (data: Buffer) => {
            appendOutput(session, `[stderr] ${data.toString()}`);
          });

          // 프로세스 종료 핸들링
          child.on("close", (code) => {
            session.endTime = new Date();
            session.exitCode = code;
            session.status = code === 0 ? "completed" : "error";
          });

          child.on("error", (err) => {
            session.status = "error";
            appendOutput(session, `[error] ${err.message}`);
          });

          // unref로 부모 프로세스와 분리
          child.unref();

          sessions.set(sessionId, session);

          return `Background session started.
Session ID: ${sessionId}
PID: ${child.pid}
Command: ${command}
CWD: ${cwd}

Use list_sessions to see all sessions, get_session_log to view output, kill_session to terminate.`;
        }

        // Foreground 실행 (기존 방식)
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout,
            env: safeEnv,
          });
          return stdout || stderr || "Command executed (no output)";
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "list_sessions": {
        const statusFilter = (input.status as string) || "all";
        
        const sessionList: string[] = [];
        
        for (const [id, session] of sessions) {
          // 상태 필터링
          if (statusFilter !== "all") {
            if (statusFilter === "running" && session.status !== "running") continue;
            if (statusFilter === "completed" && session.status === "running") continue;
          }

          const runtime = session.endTime 
            ? `${Math.round((session.endTime.getTime() - session.startTime.getTime()) / 1000)}s`
            : `${Math.round((Date.now() - session.startTime.getTime()) / 1000)}s (running)`;

          const status = session.status === "running" 
            ? "🟢 running" 
            : session.status === "completed" 
              ? "✅ completed" 
              : session.status === "killed"
                ? "🔴 killed"
                : "❌ error";

          sessionList.push(`[${id}] ${status}
  Command: ${session.command}
  PID: ${session.pid}
  Runtime: ${runtime}
  Exit code: ${session.exitCode ?? "N/A"}`);
        }

        if (sessionList.length === 0) {
          return `No sessions found${statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.`;
        }

        return `Sessions (${sessionList.length}):\n\n${sessionList.join("\n\n")}`;
      }

      case "get_session_log": {
        const sessionId = input.session_id as string;
        const tail = (input.tail as number) || 50;

        const session = sessions.get(sessionId);
        if (!session) {
          return `Error: Session "${sessionId}" not found. Use list_sessions to see available sessions.`;
        }

        const lines = session.outputBuffer.slice(-tail);
        
        if (lines.length === 0) {
          return `Session ${sessionId} has no output yet.
Status: ${session.status}
Command: ${session.command}`;
        }

        const header = `Session: ${sessionId} (${session.status})
Command: ${session.command}
Showing last ${lines.length} lines:
${"─".repeat(40)}`;

        return `${header}\n${lines.join("\n")}`;
      }

      case "kill_session": {
        const sessionId = input.session_id as string;
        const signal = (input.signal as NodeJS.Signals) || "SIGTERM";

        const session = sessions.get(sessionId);
        if (!session) {
          return `Error: Session "${sessionId}" not found.`;
        }

        if (session.status !== "running") {
          return `Session ${sessionId} is not running (status: ${session.status}).`;
        }

        try {
          // Process group kill (negative PID)
          process.kill(-session.pid, signal);
          session.status = "killed";
          session.endTime = new Date();
          return `Session ${sessionId} (PID ${session.pid}) killed with ${signal}.`;
        } catch (error) {
          // 단일 프로세스 kill 시도
          try {
            session.process.kill(signal);
            session.status = "killed";
            session.endTime = new Date();
            return `Session ${sessionId} killed with ${signal}.`;
          } catch (e) {
            return `Error killing session: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }

      case "change_model": {
        const modelId = input.model as ModelId;
        const reason = input.reason as string || "";
        const chatId = getCurrentChatId();

        if (!chatId) {
          return "Error: No active chat session";
        }

        if (!(modelId in MODELS)) {
          return `Error: Unknown model "${modelId}". Available: sonnet, opus, haiku`;
        }

        const oldModel = getModel(chatId);
        setModel(chatId, modelId);

        const newModel = MODELS[modelId];
        return `Model changed: ${MODELS[oldModel].name} → ${newModel.name}${reason ? ` (${reason})` : ""}. The change will take effect from the next message.`;
      }

      case "save_memory": {
        const content = input.content as string;
        const category = (input.category as string) || "other";

        await appendToMemory(`[${category}] ${content}`);
        return `Memory saved: ${content.slice(0, 50)}...`;
      }

      case "save_persona": {
        const identity = input.identity as string;
        const soul = input.soul as string;
        const user = input.user as string;

        // 각 파일 저장
        await saveWorkspaceFile("IDENTITY.md", identity);
        await saveWorkspaceFile("SOUL.md", soul);
        await saveWorkspaceFile("USER.md", user);

        // BOOTSTRAP.md 삭제
        await deleteBootstrap();

        return "Persona saved! BOOTSTRAP mode complete. I'm ready to chat with my new identity.";
      }

      case "get_weather": {
        const city = input.city as string;
        const country = input.country as string | undefined;

        const apiKey = await getSecret("openweathermap-api-key");
        if (!apiKey) {
          return "Error: OpenWeatherMap API key not configured. Ask user to set it up with /weather_setup command.";
        }

        const query = country ? `${city},${country}` : city;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&appid=${apiKey}&units=metric&lang=kr`;

        try {
          const response = await fetch(url);
          const data = await response.json();

          if (data.cod !== 200) {
            return `Error: ${data.message || "City not found"}`;
          }

          const weather = {
            city: data.name,
            country: data.sys.country,
            temp: Math.round(data.main.temp),
            feels_like: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            description: data.weather[0].description,
            wind: data.wind.speed,
          };

          return `Weather in ${weather.city}, ${weather.country}:
- Condition: ${weather.description}
- Temperature: ${weather.temp}°C (feels like ${weather.feels_like}°C)
- Humidity: ${weather.humidity}%
- Wind: ${weather.wind} m/s`;
        } catch (error) {
          return `Error fetching weather: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "set_reminder": {
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

      case "list_reminders": {
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

      case "cancel_reminder": {
        const id = input.id as string;
        const success = await deleteReminder(id);

        if (success) {
          return `Reminder ${id} cancelled.`;
        } else {
          return `Reminder ${id} not found.`;
        }
      }

      case "get_calendar_events": {
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

      case "add_calendar_event": {
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

      case "delete_calendar_event": {
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

      case "control_heartbeat": {
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

      case "run_heartbeat_check": {
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

      case "control_briefing": {
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

      case "send_briefing_now": {
        const chatId = getCurrentChatId();
        if (!chatId) {
          return "Error: No active chat session";
        }

        await sendBriefingNow(chatId);
        return "Briefing sent!";
      }

      // ============== Sub-Agent 도구 ==============
      case "spawn_agent": {
        const chatId = getCurrentChatId();
        if (!chatId) {
          return "Error: No active chat session";
        }

        const task = input.task as string;
        if (!task || task.trim().length === 0) {
          return "Error: Task description is required";
        }

        const agentId = await spawnAgent(task, chatId);
        return `Sub-agent spawned! 🤖\nID: ${agentId}\nTask: ${task.slice(0, 100)}${task.length > 100 ? "..." : ""}\n\nThe agent is working in the background. Results will be sent to this chat when complete.`;
      }

      case "list_agents": {
        const chatId = getCurrentChatId();
        const agents = listAgents(chatId || undefined);

        if (agents.length === 0) {
          return "No sub-agents found.";
        }

        const lines = agents.map((a) => {
          const status = {
            running: "🔄 Running",
            completed: "✅ Completed",
            failed: "❌ Failed",
            cancelled: "⏹️ Cancelled",
          }[a.status];

          const time = a.completedAt
            ? `(${Math.round((a.completedAt.getTime() - a.createdAt.getTime()) / 1000)}s)`
            : "";

          return `${a.id}: ${status} ${time}\n   Task: ${a.task.slice(0, 60)}${a.task.length > 60 ? "..." : ""}`;
        });

        return `Sub-agents:\n${lines.join("\n\n")}`;
      }

      case "cancel_agent": {
        const agentId = input.agent_id as string;
        if (!agentId) {
          return "Error: Agent ID is required";
        }

        const success = cancelAgent(agentId);
        if (success) {
          return `Sub-agent ${agentId} cancelled.`;
        } else {
          return `Could not cancel agent ${agentId}. It may not exist or already completed.`;
        }
      }

      // ============== 웹 검색/가져오기 ==============
      case "web_search": {
        const query = input.query as string;
        const count = Math.min(Math.max((input.count as number) || 5, 1), 20);

        const apiKey = await getSecret("brave-api-key");
        if (!apiKey) {
          return "Error: Brave API key not configured. Ask user to set it up with: npm run setup brave <API_KEY>";
        }

        try {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
          const response = await fetch(url, {
            headers: {
              "Accept": "application/json",
              "X-Subscription-Token": apiKey,
            },
          });

          if (!response.ok) {
            return `Error: Brave Search API returned ${response.status}: ${response.statusText}`;
          }

          const data = await response.json();
          const results = data.web?.results || [];

          if (results.length === 0) {
            return `No results found for "${query}"`;
          }

          const formatted = results.map((r: { title: string; url: string; description: string }, i: number) => {
            return `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.description || ""}`;
          });

          return `Search results for "${query}":\n\n${formatted.join("\n\n")}`;
        } catch (error) {
          return `Error searching: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      case "web_fetch": {
        const url = input.url as string;
        const maxChars = (input.maxChars as number) || 5000;

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          return "Error: URL must start with http:// or https://";
        }

        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; CompanionBot/1.0)",
            },
          });

          if (!response.ok) {
            return `Error: Failed to fetch URL (${response.status}: ${response.statusText})`;
          }

          const html = await response.text();
          const $ = cheerio.load(html);

          // 불필요한 요소 제거
          $("script, style, nav, header, footer, aside, iframe, noscript").remove();

          // 본문 텍스트 추출
          let text = "";
          
          // article 태그 우선
          const article = $("article");
          if (article.length > 0) {
            text = article.text();
          } else {
            // main 태그 시도
            const main = $("main");
            if (main.length > 0) {
              text = main.text();
            } else {
              // body 전체
              text = $("body").text();
            }
          }

          // 공백 정리
          text = text
            .replace(/\s+/g, " ")
            .replace(/\n\s*\n/g, "\n")
            .trim();

          // 길이 제한
          if (text.length > maxChars) {
            text = text.slice(0, maxChars) + "... (truncated)";
          }

          const title = $("title").text().trim() || "No title";
          return `Title: ${title}\n\nContent:\n${text}`;
        } catch (error) {
          return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      // ============== Cron 도구 ==============
      case "add_cron": {
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

      case "list_crons": {
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

      case "remove_cron": {
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

      case "toggle_cron": {
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

      case "run_cron": {
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

      default:
        return `Error: Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// 도구 설명 생성 (시스템 프롬프트용)
export function getToolsDescription(modelId: ModelId): string {
  const model = MODELS[modelId];

  return `# 사용 가능한 도구

현재 모델: ${model.name}

## 파일 작업
- read_file: 파일 읽기
- write_file: 파일 생성/수정
- edit_file: 파일의 특정 부분만 수정 (oldText → newText, 정확히 일치해야 함)
- list_directory: 디렉토리 탐색

## 시스템
- run_command: 셸 명령어 실행 (git, npm 등)
  - background=true: 백그라운드 실행, 세션 ID 반환
- list_sessions: 백그라운드 세션 목록
- get_session_log: 세션 출력 로그 조회
- kill_session: 세션 종료
- change_model: AI 모델 변경
  - sonnet: 범용 (기본)
  - opus: 복잡한 작업
  - haiku: 간단한 작업

## 기억
- save_memory: 중요한 정보 저장

## 날씨
- get_weather: 현재 날씨 조회 (도시명 필요)

## 리마인더
- set_reminder: 알림 설정 ("10분 후", "내일 9시" 등)
- list_reminders: 활성 리마인더 목록
- cancel_reminder: 리마인더 취소

## 캘린더 (Google Calendar)
- get_calendar_events: 일정 조회 (today, tomorrow, week)
- add_calendar_event: 일정 추가
- delete_calendar_event: 일정 삭제

## Heartbeat
- control_heartbeat: 하트비트 on/off/상태 확인, 간격 설정
- run_heartbeat_check: 지금 바로 체크

## 브리핑
- control_briefing: 일일 브리핑 on/off/상태, 시간/도시 설정
- send_briefing_now: 지금 바로 브리핑

## 온보딩
- save_persona: 페르소나 설정 저장 (온보딩 완료 시)

## Sub-Agent (백그라운드 작업)
- spawn_agent: 복잡한 작업을 sub-agent에게 위임 (독립 실행)
- list_agents: 활성 sub-agent 목록
- cancel_agent: sub-agent 취소

## 웹 검색/가져오기
- web_search: Brave Search API로 웹 검색 (query, count)
- web_fetch: URL에서 본문 텍스트 추출 (url, maxChars)

## Cron (예약 작업)
- add_cron: 예약 작업 생성
  - name: 작업 이름
  - schedule: cron 표현식 또는 한국어 ("0 9 * * *", "매일 아침 9시", "30분마다")
  - payload: 실행할 작업 ({ kind: "agentTurn", message: "..." })
- list_crons: 현재 채팅의 cron job 목록
- remove_cron: cron job 삭제 (id)
- toggle_cron: cron job 활성화/비활성화 (id, enabled)
- run_cron: cron job 즉시 실행 (id) - 테스트/수동 트리거용

허용된 경로: ${path.join(home, "Documents")}, ${path.join(home, "projects")}, 워크스페이스`;
}
