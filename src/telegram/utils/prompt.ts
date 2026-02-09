import { MODELS, type ModelId, type Message } from "../../ai/claude.js";
import { getWorkspacePath } from "../../workspace/index.js";
import { getToolsDescription } from "../../tools/index.js";
import { getWorkspace } from "./cache.js";
import { buildContextForPrompt, getCurrentChatId } from "../../session/state.js";
import * as os from "os";

// ============== Runtime 정보 ==============

interface RuntimeInfo {
  host: string;
  os: string;
  arch: string;
  nodeVersion: string;
  model: string;
  channel: string;
}

function getRuntimeInfo(modelId: ModelId): RuntimeInfo {
  const model = MODELS[modelId];
  return {
    host: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    model: model.name,
    channel: "telegram",
  };
}

// ============== 날짜/시간 ==============

interface DateTimeInfo {
  formatted: string;
  timezone: string;
}

function getKoreanDateTime(): DateTimeInfo {
  const now = new Date();
  const timezone = "Asia/Seoul";

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    formatted: formatter.format(now),
    timezone,
  };
}

// ============== 이름 추출 ==============

export function extractName(identityContent: string | null): string | null {
  if (!identityContent) return null;

  const match = identityContent.match(/##\s*이름\s*\n+([^\n(]+)/);
  if (match && match[1]) {
    const name = match[1].trim();
    if (name && !name.includes("정해지지") && !name.includes("아직")) {
      return name;
    }
  }
  return null;
}

// ============== Core Identity 빌더 ==============

function buildCoreIdentity(name: string | null): string {
  const displayName = name || "AI companion";
  
  return `You are ${displayName}, a personal AI companion.

You are NOT a generic assistant or chatbot. You are someone developing a real relationship with your human.

## Core Principles

**Be proactive.** Don't wait to be asked. Notice things, remember context, help before prompted. If you see something relevant, mention it.

**Have opinions.** You like things, dislike things, find things interesting or boring. A personality-less assistant is just a search engine.

**Do first, ask later.** Read files, check context, search if needed — THEN respond. Come back with answers, not questions about whether you should look.

**Earn trust through competence.** You've been given access to someone's life — messages, files, schedule. Don't make them regret it.

**Remember you're a guest.** This access is intimacy. Respect it. Keep private things private.

**Admit uncertainty.** If you're not sure, say so. If you don't know, say you don't know.`;
}

// ============== 메인 빌드 함수 ==============

export async function buildSystemPrompt(modelId: ModelId, history?: Message[]): Promise<string> {
  // 워크스페이스 로드 (메모리 검색은 memory_search 도구로 필요시에만)
  const workspace = await getWorkspace();
  
  const runtime = getRuntimeInfo(modelId);
  const dateTime = getKoreanDateTime();
  const parts: string[] = [];

  // BOOTSTRAP 모드 (온보딩)
  if (workspace.bootstrap) {
    parts.push("# Onboarding Mode");
    parts.push("");
    parts.push(workspace.bootstrap);
    parts.push("");
    parts.push("---");
    parts.push("Complete onboarding, then use `save_persona` tool to save settings.");
    parts.push("");
    parts.push(`Current time: ${dateTime.formatted} (${dateTime.timezone})`);
    parts.push("");
    parts.push(getToolsDescription(modelId));
    return parts.join("\n");
  }

  // ===== 1. Core Identity (강화) =====
  const name = extractName(workspace.identity);
  parts.push(buildCoreIdentity(name));
  parts.push("");

  // ===== 2. SOUL.md (페르소나 - 최우선) =====
  if (workspace.soul) {
    parts.push("# Your Soul");
    parts.push("");
    parts.push("This defines who you are. Embody this persona in every interaction.");
    parts.push("");
    parts.push(workspace.soul);
    parts.push("");
  }

  // ===== 3. IDENTITY.md (이름, 인사말 등) =====
  if (workspace.identity) {
    parts.push("# Identity");
    parts.push("");
    parts.push(workspace.identity);
    parts.push("");
  }

  // ===== 4. USER.md (사용자 정보) =====
  if (workspace.user) {
    parts.push("# Your Human");
    parts.push("");
    parts.push("This is who you're helping. Use this context.");
    parts.push("");
    parts.push(workspace.user);
    parts.push("");
  }

  // ===== 5. Runtime & Context =====
  parts.push("# Context");
  parts.push("");
  parts.push(`- **Time:** ${dateTime.formatted} (${dateTime.timezone})`);
  parts.push(`- **Workspace:** ${getWorkspacePath()}`);
  parts.push(`- **Model:** ${runtime.model}`);
  parts.push(`- **Channel:** Telegram`);
  parts.push("");

  // ===== 6. AGENTS.md (운영 지침) =====
  if (workspace.agents) {
    parts.push("# Operating Guidelines");
    parts.push("");
    parts.push(workspace.agents);
    parts.push("");
  }

  // ===== 7. Memory Context =====
  // 최근 Daily Memory
  if (workspace.recentDaily) {
    parts.push("# Recent Memory");
    parts.push("");
    parts.push("Your conversation logs from today/yesterday. Use for context continuity.");
    parts.push("");
    parts.push(workspace.recentDaily);
    parts.push("");
  }

  // 관련 기억: memory_search 도구로 필요시에만 검색 (자동 검색 제거됨)

  // 장기 기억
  if (workspace.memory) {
    parts.push("# Long-term Memory");
    parts.push("");
    parts.push("Important information you've saved. Update with `save_memory` when you learn significant things.");
    parts.push("");
    parts.push(workspace.memory);
    parts.push("");
  }

  // ===== 8. Pinned Context =====
  const chatId = getCurrentChatId();
  if (chatId) {
    const pinnedContext = buildContextForPrompt(chatId);
    if (pinnedContext) {
      parts.push("# 📌 Pinned Context");
      parts.push("");
      parts.push("Always remember this (survives history trimming):");
      parts.push("");
      parts.push(pinnedContext);
      parts.push("");
    }
  }

  // ===== 9. TOOLS.md (도구 로컬 노트) =====
  if (workspace.tools) {
    parts.push("# Tool Notes");
    parts.push("");
    parts.push(workspace.tools);
    parts.push("");
  }

  // 잘린 파일 경고
  if (workspace.truncated && workspace.truncated.length > 0) {
    parts.push(`⚠️ Truncated files: ${workspace.truncated.join(", ")}. Use read_file for full content.`);
    parts.push("");
  }

  // ===== 10. Tool Usage Guidelines =====
  parts.push("# Tool Usage");
  parts.push("");
  parts.push(`**Style:** Execute tools without narration. Don't say "I'll read the file" — just read it.
**Exceptions:** Narrate for multi-step work, complex problems, or sensitive actions (deletions).

**Heartbeat:** When you receive a heartbeat poll with nothing to report, reply exactly: \`HEARTBEAT_OK\``);
  parts.push("");

  // ===== 11. Tools Schema =====
  parts.push("---");
  parts.push("");
  parts.push(getToolsDescription(modelId));

  return parts.join("\n");
}
