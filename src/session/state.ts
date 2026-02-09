import { AsyncLocalStorage } from "async_hooks";
import type { ModelId } from "../ai/claude.js";
import type { Message } from "../ai/claude.js";
import { estimateMessagesTokens } from "../utils/tokens.js";

// 세션 설정
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24시간
const MAX_HISTORY_TOKENS = 40000; // 시스템 프롬프트(~10k) + 응답(~8k) 여유 남기고

type SessionData = {
  history: Message[];
  model: ModelId;
  lastAccessedAt: number;
};

// 세션별 상태 저장
const sessions = new Map<number, SessionData>();

// AsyncLocalStorage for chatId context
const chatIdStorage = new AsyncLocalStorage<number>();

function getSession(chatId: number): SessionData {
  // chatId 유효성 검사
  if (chatId == null || isNaN(chatId)) {
    console.error(`[Session] BUG: Invalid chatId: ${chatId} - history will NOT persist!`);
    // 임시 세션 반환 (저장하지 않음) - 이건 버그 상황
    return {
      history: [],
      model: "sonnet",
      lastAccessedAt: Date.now(),
    };
  }

  const existing = sessions.get(chatId);
  const now = Date.now();

  if (existing) {
    existing.lastAccessedAt = now;
    console.log(`[Session] Returning existing session for chatId=${chatId}, history length=${existing.history?.length ?? 0}`);
    return existing;
  }

  // 새 세션 생성 전 정리
  cleanupSessions();

  const session: SessionData = {
    history: [],
    model: "sonnet",
    lastAccessedAt: now,
  };
  sessions.set(chatId, session);
  console.log(`[Session] Created new session for chatId=${chatId}, total sessions=${sessions.size}`);
  return session;
}

function cleanupSessions(): void {
  const now = Date.now();

  // 1. TTL 만료된 세션 삭제
  for (const [chatId, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(chatId);
    }
  }

  // 2. 최대 개수 초과 시 LRU 방식으로 삭제
  if (sessions.size >= MAX_SESSIONS) {
    const entries = Array.from(sessions.entries());
    entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    const toRemove = entries.slice(0, sessions.size - MAX_SESSIONS + 1);
    for (const [chatId] of toRemove) {
      sessions.delete(chatId);
    }
  }
}

export function getHistory(chatId: number): Message[] {
  const session = getSession(chatId);
  // history가 없으면 초기화하고 세션에 저장
  if (!session.history) {
    session.history = [];
  }
  // 참조 반환 (외부 수정 허용 - 의도적)
  return session.history;
}

/**
 * 히스토리를 토큰 기반으로 트리밍한다.
 * 최대 토큰 한도를 초과하면 가장 오래된 메시지부터 제거 (최소 2개는 유지).
 */
export function trimHistoryByTokens(history: Message[] | null | undefined): void {
  // null/undefined/빈 배열 처리
  if (!history || history.length === 0) {
    return;
  }
  
  while (estimateMessagesTokens(history) > MAX_HISTORY_TOKENS && history.length > 2) {
    history.shift();
  }
}

export function clearHistory(chatId: number): void {
  sessions.delete(chatId);
}

export function getModel(chatId: number): ModelId {
  return getSession(chatId).model;
}

export function setModel(chatId: number, modelId: ModelId): void {
  getSession(chatId).model = modelId;
}

/**
 * Run a function with chatId context using AsyncLocalStorage.
 * All code inside the callback can access the chatId via getCurrentChatId().
 */
export function runWithChatId<T>(chatId: number, fn: () => T): T {
  return chatIdStorage.run(chatId, fn);
}

/**
 * Get the current chatId from AsyncLocalStorage context.
 * Returns null if called outside of runWithChatId().
 */
export function getCurrentChatId(): number | null {
  return chatIdStorage.getStore() ?? null;
}

// 세션 정리 (수동 호출용)
export function cleanupExpiredSessions(): number {
  const before = sessions.size;
  cleanupSessions();
  return before - sessions.size;
}

// 현재 세션 수 조회
export function getSessionCount(): number {
  return sessions.size;
}
