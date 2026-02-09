/**
 * Tools module - exports and routing
 * 
 * 도메인별로 분할된 모듈에서 기능을 가져와 라우팅
 */

import * as path from "path";
import { MODELS, type ModelId } from "../ai/claude.js";
import { getWorkspacePath } from "../workspace/index.js";

// 분할된 모듈에서 import
import { home } from "./utils.js";
import {
  executeRunCommand,
  executeListSessions,
  executeGetSessionLog,
  executeKillSession,
} from "./session.js";
import {
  executeReadFile,
  executeWriteFile,
  executeEditFile,
  executeListDirectory,
} from "./file.js";
import {
  executeWebSearch,
  executeWebFetch,
} from "./web.js";
import {
  executeSetReminder,
  executeListReminders,
  executeCancelReminder,
  executeGetCalendarEvents,
  executeAddCalendarEvent,
  executeDeleteCalendarEvent,
  executeControlHeartbeat,
  executeRunHeartbeatCheck,
  executeControlBriefing,
  executeSendBriefingNow,
  executeAddCron,
  executeListCrons,
  executeRemoveCron,
  executeToggleCron,
  executeRunCron,
} from "./schedule.js";
import {
  executeSaveMemory,
  executeSavePersona,
  executeMemorySearch,
  executeMemoryReindex,
} from "./memory.js";
import { executeGetWeather } from "./weather.js";
import {
  executeSpawnAgent,
  executeListAgents,
  executeCancelAgent,
} from "./agent.js";
import { executeChangeModel } from "./model.js";

// Re-export utilities for external use
export { isPathAllowed, getAllowedPaths, DANGEROUS_PATTERNS } from "./pathCheck.js";
export { isPrivateIP, home } from "./utils.js";

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
    description: `Save important information to daily memory. This is automatically saved to memory/YYYY-MM-DD.md.

**WHEN TO USE (proactively, without being asked):**
- User shares personal info: name, birthday, family, job, location
- User expresses preferences: likes, dislikes, habits, routines
- User mentions plans: upcoming events, projects, goals
- User shares emotional moments: achievements, concerns, decisions
- Significant conversation outcomes: agreements, conclusions, learnings
- Technical context: project names, tech stack, environments

**WHEN NOT TO USE:**
- Trivial small talk
- Already recorded information
- Temporary/fleeting topics

**TIPS:**
- Be concise but include context (why it matters)
- Include date references for time-sensitive info
- Group related facts together`,
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The information to remember. Be specific and include context.",
        },
        category: {
          type: "string",
          enum: ["user_info", "preference", "event", "project", "decision", "emotion", "other"],
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
  // ============== 메모리 검색 ==============
  {
    name: "memory_search",
    description: "Search through long-term memories using semantic similarity. Use this when the user asks about past conversations, events, or information that might be stored in memory.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query - what to look for in memories"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 5)"
        },
        minScore: {
          type: "number",
          description: "Minimum similarity score 0-1 (default: 0.3). Lower = more results but less relevant."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "memory_reindex",
    description: "Reindex all memory files. Use when memories seem outdated or after major memory updates.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: []
    }
  },
];

// Tool 실행 함수 - 각 모듈로 라우팅
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      // 파일 작업
      case "read_file":
        return await executeReadFile(input);
      case "write_file":
        return await executeWriteFile(input);
      case "edit_file":
        return await executeEditFile(input);
      case "list_directory":
        return await executeListDirectory(input);

      // 세션/명령어
      case "run_command":
        return await executeRunCommand(input);
      case "list_sessions":
        return executeListSessions(input);
      case "get_session_log":
        return executeGetSessionLog(input);
      case "kill_session":
        return executeKillSession(input);

      // 모델
      case "change_model":
        return executeChangeModel(input);

      // 메모리
      case "save_memory":
        return await executeSaveMemory(input);
      case "save_persona":
        return await executeSavePersona(input);
      case "memory_search":
        return await executeMemorySearch(input);
      case "memory_reindex":
        return await executeMemoryReindex();

      // 날씨
      case "get_weather":
        return await executeGetWeather(input);

      // 리마인더
      case "set_reminder":
        return await executeSetReminder(input);
      case "list_reminders":
        return await executeListReminders();
      case "cancel_reminder":
        return await executeCancelReminder(input);

      // 캘린더
      case "get_calendar_events":
        return await executeGetCalendarEvents(input);
      case "add_calendar_event":
        return await executeAddCalendarEvent(input);
      case "delete_calendar_event":
        return await executeDeleteCalendarEvent(input);

      // Heartbeat
      case "control_heartbeat":
        return await executeControlHeartbeat(input);
      case "run_heartbeat_check":
        return await executeRunHeartbeatCheck();

      // Briefing
      case "control_briefing":
        return await executeControlBriefing(input);
      case "send_briefing_now":
        return await executeSendBriefingNow();

      // Sub-Agent
      case "spawn_agent":
        return await executeSpawnAgent(input);
      case "list_agents":
        return executeListAgents();
      case "cancel_agent":
        return executeCancelAgent(input);

      // 웹
      case "web_search":
        return await executeWebSearch(input);
      case "web_fetch":
        return await executeWebFetch(input);

      // Cron
      case "add_cron":
        return await executeAddCron(input);
      case "list_crons":
        return await executeListCrons(input);
      case "remove_cron":
        return await executeRemoveCron(input);
      case "toggle_cron":
        return await executeToggleCron(input);
      case "run_cron":
        return await executeRunCron(input);

      default:
        return `Error: Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// 도구 설명 캐시 (모델별)
const toolsDescriptionCache = new Map<ModelId, string>();

// 도구 설명 생성 (시스템 프롬프트용) - 캐시됨
export function getToolsDescription(modelId: ModelId): string {
  // 캐시 확인
  const cached = toolsDescriptionCache.get(modelId);
  if (cached) return cached;

  const model = MODELS[modelId];

  const description = `# 사용 가능한 도구

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

## 메모리 검색
- memory_search: 장기 기억에서 시맨틱 검색 (query, limit)
- memory_reindex: 메모리 파일 재인덱싱

허용된 경로: ${path.join(home, "Documents")}, ${path.join(home, "projects")}, 워크스페이스`;

  // 캐시에 저장
  toolsDescriptionCache.set(modelId, description);
  return description;
}
