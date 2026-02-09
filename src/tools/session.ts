/**
 * Session management for background commands
 */

import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { exec } from "child_process";
import {
  SESSION_MAX_OUTPUT_LINES,
  SESSION_CLEANUP_INTERVAL_MS,
  SESSION_TTL_MS,
} from "../utils/constants.js";
import { home } from "./utils.js";
import * as path from "path";

const execAsync = promisify(exec);

// ============== 세션 관리 ==============
export interface ProcessSession {
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

// 완료된 세션 자동 정리 함수
function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    // 완료/에러/종료된 세션만 정리
    if (session.status !== "running" && session.endTime) {
      const age = now - session.endTime.getTime();
      if (age > SESSION_TTL_MS) {
        sessions.delete(id);
      }
    }
  }
}

// 주기적 세션 정리 시작
setInterval(cleanupStaleSessions, SESSION_CLEANUP_INTERVAL_MS);

function appendOutput(session: ProcessSession, data: string) {
  const lines = data.split("\n");
  session.outputBuffer.push(...lines);
  // 버퍼 크기 제한
  if (session.outputBuffer.length > SESSION_MAX_OUTPUT_LINES) {
    session.outputBuffer = session.outputBuffer.slice(-SESSION_MAX_OUTPUT_LINES);
  }
}

// 화이트리스트 방식: 허용된 명령어만 실행
const ALLOWED_COMMANDS = [
  "git", "npm", "npx", "node", "ls", "pwd", "cat", "head", "tail",
  "grep", "find", "wc", "sort", "uniq", "diff", "echo", "date",
  "which", "env", "printenv"
];

// 위험한 인자
const DANGEROUS_ARGS = ["--force", "-rf", "--hard", "--no-preserve-root"];

// 안전한 환경 변수
function getSafeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
    USER: process.env.USER || "",
    LANG: process.env.LANG || "en_US.UTF-8",
    TERM: process.env.TERM || "xterm",
  };
}

// 명령어 검증
function validateCommand(command: string): { valid: boolean; error?: string } {
  // 명령어 체이닝/치환/리디렉션 차단
  if (/[;&|`\n\r]|\$\(|\$\{|>>|>|</.test(command)) {
    return { valid: false, error: "Command chaining, substitution, and redirection not allowed." };
  }

  // 첫 번째 명령어 추출
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  if (!ALLOWED_COMMANDS.includes(cmd)) {
    return { valid: false, error: `Command '${cmd}' not in allowed list. Allowed: ${ALLOWED_COMMANDS.join(", ")}` };
  }

  // 위험한 인자 차단
  if (DANGEROUS_ARGS.some(arg => parts.includes(arg))) {
    return { valid: false, error: "Dangerous argument detected." };
  }

  return { valid: true };
}

// run_command 실행
export async function executeRunCommand(input: Record<string, unknown>): Promise<string> {
  const command = input.command as string;
  const cwd = (input.cwd as string) || path.join(home, "Documents");
  const background = (input.background as boolean) || false;
  const timeout = ((input.timeout as number) || 30) * 1000;

  const validation = validateCommand(command);
  if (!validation.valid) {
    return `Error: ${validation.error}`;
  }

  const safeEnv = getSafeEnv();

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

// list_sessions 실행
export function executeListSessions(input: Record<string, unknown>): string {
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

// get_session_log 실행
export function executeGetSessionLog(input: Record<string, unknown>): string {
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

// kill_session 실행
export function executeKillSession(input: Record<string, unknown>): string {
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
