/**
 * Tool definitions - compact version for token optimization
 * 
 * 원본 대비 ~40% 토큰 절감
 * - description 간소화
 * - 예제 제거 (모델이 이미 학습된 패턴 활용)
 * - enum으로 명확한 옵션 제공
 */

// 전체 도구 목록 (압축 버전)
export const compactTools = [
  // === 파일 작업 ===
  {
    name: "read_file",
    description: "Read file contents",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to file" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to file (creates or overwrites)",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace exact text in file (oldText must match exactly)",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        oldText: { type: "string", description: "Exact text to find" },
        newText: { type: "string", description: "Replacement text" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Directory path" },
      },
      required: ["path"],
    },
  },

  // === 명령 실행 ===
  {
    name: "run_command",
    description: "Run shell command. background=true returns session ID for long-running commands",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Working directory (optional)" },
        background: { type: "boolean", description: "Run in background" },
        timeout: { type: "number", description: "Timeout in seconds (default: 30)" },
      },
      required: ["command"],
    },
  },
  {
    name: "manage_session",
    description: "Manage background command sessions",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["list", "log", "kill"], description: "Action to perform" },
        session_id: { type: "string", description: "Session ID (for log/kill)" },
        tail: { type: "number", description: "Lines to show (log action, default: 50)" },
        signal: { type: "string", enum: ["SIGTERM", "SIGKILL", "SIGINT"] },
      },
      required: ["action"],
    },
  },

  // === 모델/메모리 ===
  {
    name: "change_model",
    description: "Switch AI model: sonnet (default), opus (complex), haiku (simple)",
    input_schema: {
      type: "object" as const,
      properties: {
        model: { type: "string", enum: ["sonnet", "opus", "haiku"] },
        reason: { type: "string" },
      },
      required: ["model"],
    },
  },
  {
    name: "save_memory",
    description: "중요한 정보 저장. 사용자 정보, 선호도, 약속, 결정 등 나중에 기억해야 할 것들",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "기억할 내용" },
        category: { type: "string", enum: ["user_info", "preference", "event", "project", "decision", "emotion", "other"] },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description: "과거 기억 검색. 이전에 나눈 대화, 저장한 정보, 사용자 선호도 등을 찾을 때 사용",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "검색할 내용" },
        limit: { type: "number", description: "Max results (default: 5)" },
        minScore: { type: "number", description: "Min similarity 0-1 (default: 0.3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_reindex",
    description: "Reindex all memory files",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },

  // === 날씨/웹 ===
  {
    name: "get_weather",
    description: "현재 날씨 조회. 외출, 옷차림, 우산 필요 여부 등 물어볼 때 사용",
    input_schema: {
      type: "object" as const,
      properties: {
        city: { type: "string", description: "도시명 (예: Seoul, Tokyo)" },
        country: { type: "string", description: "Country code (optional)" },
      },
      required: ["city"],
    },
  },
  {
    name: "web_search",
    description: "웹 검색 (Brave API). 최신 정보, 뉴스, 사실 확인이 필요할 때 사용. 검색어로 관련 결과 반환",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "검색어" },
        count: { type: "number", description: "Results count (default: 5, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: "URL에서 웹페이지 본문 추출. 링크 내용 확인, 기사 읽기, 문서 요약 등에 사용. HTML → 텍스트 변환",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "가져올 웹페이지 URL" },
        maxChars: { type: "number", description: "Max chars (default: 5000)" },
      },
      required: ["url"],
    },
  },

  // === 리마인더/캘린더 ===
  {
    name: "reminder",
    description: "Manage reminders: set/list/cancel",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["set", "list", "cancel"] },
        message: { type: "string", description: "Reminder message (set)" },
        time_expr: { type: "string", description: "Korean time: '10분 후', '내일 9시' (set)" },
        id: { type: "string", description: "Reminder ID (cancel)" },
      },
      required: ["action"],
    },
  },
  {
    name: "calendar",
    description: "Google Calendar: get/add/delete events",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["get", "add", "delete"] },
        date_range: { type: "string", enum: ["today", "tomorrow", "week"], description: "For get action" },
        title: { type: "string", description: "Event title (add)" },
        time_expr: { type: "string", description: "Korean time (add)" },
        description: { type: "string" },
        event_id: { type: "string", description: "Event ID (delete)" },
      },
      required: ["action"],
    },
  },

  // === Cron ===
  {
    name: "cron",
    description: "Scheduled tasks: add/list/remove/toggle/run",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "list", "remove", "toggle", "run"] },
        name: { type: "string", description: "Job name (add)" },
        schedule: { type: "string", description: "Cron expr or Korean time (add)" },
        payload: { type: "object", description: "{ kind: 'agentTurn', message: '...' } (add)" },
        id: { type: "string", description: "Job ID (remove/toggle/run)" },
        enabled: { type: "boolean", description: "Enable state (toggle)" },
        show_disabled: { type: "boolean" },
      },
      required: ["action"],
    },
  },

  // === Heartbeat/Briefing ===
  {
    name: "heartbeat",
    description: "Heartbeat: on/off/status/check",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["on", "off", "status", "check"] },
        interval_minutes: { type: "number", description: "Check interval (5-1440)" },
      },
      required: ["action"],
    },
  },
  {
    name: "briefing",
    description: "Daily briefing: on/off/status/now",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["on", "off", "status", "now"] },
        time: { type: "string", description: "HH:MM format" },
        city: { type: "string", description: "City for weather" },
      },
      required: ["action"],
    },
  },

  // === Sub-Agent ===
  {
    name: "agent",
    description: "Sub-agents: spawn/list/cancel",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["spawn", "list", "cancel"] },
        task: { type: "string", description: "Task description (spawn)" },
        agent_id: { type: "string", description: "Agent ID (cancel)" },
      },
      required: ["action"],
    },
  },

  // === 온보딩 ===
  {
    name: "save_persona",
    description: "Save persona after onboarding (IDENTITY.md, SOUL.md, USER.md)",
    input_schema: {
      type: "object" as const,
      properties: {
        identity: { type: "string" },
        soul: { type: "string" },
        user: { type: "string" },
      },
      required: ["identity", "soul", "user"],
    },
  },
];

// 도구 수 비교
// 원본: 36개 도구
// 압축: 20개 도구 (통합으로 ~44% 감소)
// description 압축: ~60% 토큰 감소

/**
 * 압축 도구 사용 시 executeTool 매핑 필요
 * 예: reminder(action="set", ...) → set_reminder(...)
 * 예: cron(action="add", ...) → add_cron(...)
 */
export type CompactToolName = typeof compactTools[number]["name"];

// 압축 도구명 → 원본 도구명 매핑
export const toolActionMap: Record<string, Record<string, string>> = {
  manage_session: {
    list: "list_sessions",
    log: "get_session_log",
    kill: "kill_session",
  },
  reminder: {
    set: "set_reminder",
    list: "list_reminders",
    cancel: "cancel_reminder",
  },
  calendar: {
    get: "get_calendar_events",
    add: "add_calendar_event",
    delete: "delete_calendar_event",
  },
  cron: {
    add: "add_cron",
    list: "list_crons",
    remove: "remove_cron",
    toggle: "toggle_cron",
    run: "run_cron",
  },
  heartbeat: {
    on: "control_heartbeat",
    off: "control_heartbeat",
    status: "control_heartbeat",
    check: "run_heartbeat_check",
  },
  briefing: {
    on: "control_briefing",
    off: "control_briefing",
    status: "control_briefing",
    now: "send_briefing_now",
  },
  agent: {
    spawn: "spawn_agent",
    list: "list_agents",
    cancel: "cancel_agent",
  },
};
