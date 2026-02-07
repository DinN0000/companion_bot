import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
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

const execAsync = promisify(exec);

// 허용된 디렉토리 (보안을 위해 제한)
function getAllowedPaths(): string[] {
  return [
    "/Users/hwai/Documents",
    "/Users/hwai/projects",
    getWorkspacePath(), // 워크스페이스 경로 추가
  ];
}

function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const allowedPaths = getAllowedPaths();
  return allowedPaths.some((allowed) => resolved.startsWith(allowed));
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
    description: "Run a shell command. Use with caution. Only for safe commands like git status, npm run, etc.",
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
      },
      required: ["command"],
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
        const cwd = (input.cwd as string) || "/Users/hwai/Documents";

        // 위험한 명령어 차단
        const dangerous = ["rm -rf", "sudo", "chmod", "chown", "> /dev", "mkfs"];
        if (dangerous.some((d) => command.includes(d))) {
          return `Error: Dangerous command blocked.`;
        }

        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: 30000,
        });
        return stdout || stderr || "Command executed (no output)";
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
- list_directory: 디렉토리 탐색

## 시스템
- run_command: 셸 명령어 실행 (git, npm 등)
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

## 온보딩
- save_persona: 페르소나 설정 저장 (온보딩 완료 시)

허용된 경로: /Users/hwai/Documents, /Users/hwai/projects, 워크스페이스`;
}
