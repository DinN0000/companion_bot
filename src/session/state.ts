import { AsyncLocalStorage } from "async_hooks";
import type { ModelId, ThinkingLevel } from "../ai/claude.js";
import type { Message } from "../ai/claude.js";
import { estimateMessagesTokens, estimateTokens } from "../utils/tokens.js";
import * as persistence from "./persistence.js";
import { SESSION, TOKENS, MESSAGES } from "../config/constants.js";
import { getConfig } from "../config/index.js";

/**
 * 핀된 맥락 - 중요한 정보를 별도 보관
 * 트리밍과 무관하게 시스템 프롬프트에 주입됨
 */
export type PinnedContext = {
  text: string;
  createdAt: number;
  source: "auto" | "user"; // 자동 감지 vs 사용자 명시
};

/**
 * 요약된 히스토리 청크
 */
export type SummaryChunk = {
  summary: string;
  messageCount: number;
  startTime: number;
  endTime: number;
};

type SessionData = {
  history: Message[];
  model: ModelId;
  thinkingLevel: ThinkingLevel;
  lastAccessedAt: number;
  // 새 필드들
  pinnedContexts: PinnedContext[];
  summaryChunks: SummaryChunk[];
};

// 세션별 상태 저장
const sessions = new Map<number, SessionData>();

// AsyncLocalStorage for chatId context
const chatIdStorage = new AsyncLocalStorage<number>();

function getSession(chatId: number): SessionData {
  const config = getConfig();
  
  // chatId 유효성 검사
  if (chatId == null || isNaN(chatId)) {
    console.error(`[Session] BUG: Invalid chatId: ${chatId} - history will NOT persist!`);
    return {
      history: [],
      model: config.model.default,
      thinkingLevel: config.model.thinking,
      lastAccessedAt: Date.now(),
      pinnedContexts: [],
      summaryChunks: [],
    };
  }

  const existing = sessions.get(chatId);
  const now = Date.now();

  if (existing) {
    existing.lastAccessedAt = now;
    // 마이그레이션: 기존 세션에 새 필드 추가
    if (!existing.pinnedContexts) existing.pinnedContexts = [];
    if (!existing.summaryChunks) existing.summaryChunks = [];
    if (!existing.thinkingLevel) existing.thinkingLevel = config.model.thinking;
    return existing;
  }

  // 새 세션 생성 전 정리
  cleanupSessions();

  // 기존 JSONL 파일에서 히스토리 로드
  const persistedMessages = persistence.loadHistorySync(chatId, SESSION.MAX_HISTORY_LOAD);
  const history: Message[] = persistedMessages.map(pm => ({
    role: pm.role,
    content: pm.content,
  }));

  if (persistedMessages.length > 0) {
    const totalCount = persistence.getHistoryCount(chatId);
    console.log(`[Session] Loaded ${persistedMessages.length}/${totalCount} messages from JSONL for chatId=${chatId}`);
  }

  const session: SessionData = {
    history,
    model: config.model.default,
    thinkingLevel: config.model.thinking,
    lastAccessedAt: now,
    pinnedContexts: [],
    summaryChunks: [],
  };
  sessions.set(chatId, session);
  console.log(`[Session] Created new session for chatId=${chatId}, total sessions=${sessions.size}`);
  return session;
}

function cleanupSessions(): void {
  const now = Date.now();

  // 1. TTL 만료된 세션 삭제
  for (const [chatId, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION.TTL_MS) {
      sessions.delete(chatId);
    }
  }

  // 2. 최대 개수 초과 시 LRU 방식으로 삭제
  if (sessions.size >= SESSION.MAX_SESSIONS) {
    const entries = Array.from(sessions.entries());
    entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    const toRemove = entries.slice(0, sessions.size - SESSION.MAX_SESSIONS + 1);
    for (const [chatId] of toRemove) {
      sessions.delete(chatId);
    }
  }
}

export function getHistory(chatId: number): Message[] {
  const session = getSession(chatId);
  if (!session.history) {
    session.history = [];
  }
  return session.history;
}

/**
 * 메시지 추가 (메모리 + JSONL 파일 동기화)
 */
export function addMessage(chatId: number, role: "user" | "assistant", content: string): void {
  const history = getHistory(chatId);
  history.push({ role, content });
  
  // JSONL 파일에도 영구 저장
  persistence.appendMessage(chatId, role, content);
}

/**
 * 여러 메시지 추가 (배치)
 */
export function addMessages(chatId: number, messages: Array<{ role: "user" | "assistant"; content: string }>): void {
  for (const msg of messages) {
    addMessage(chatId, msg.role, msg.content);
  }
}

/**
 * 핀된 맥락 가져오기
 */
export function getPinnedContexts(chatId: number): PinnedContext[] {
  return getSession(chatId).pinnedContexts;
}

/**
 * 요약 청크 가져오기
 */
export function getSummaryChunks(chatId: number): SummaryChunk[] {
  return getSession(chatId).summaryChunks;
}

/**
 * 중요 맥락 핀하기
 */
export function pinContext(chatId: number, text: string, source: "auto" | "user" = "user"): boolean {
  const session = getSession(chatId);
  const currentTokens = session.pinnedContexts.reduce(
    (sum, p) => sum + estimateTokens(p.text),
    0
  );

  const newTokens = estimateTokens(text);
  
  // 토큰 한도 체크
  if (currentTokens + newTokens > TOKENS.MAX_PINNED) {
    // 오래된 자동 핀부터 제거
    while (
      session.pinnedContexts.length > 0 &&
      currentTokens + newTokens > TOKENS.MAX_PINNED
    ) {
      const autoIndex = session.pinnedContexts.findIndex((p) => p.source === "auto");
      if (autoIndex >= 0) {
        session.pinnedContexts.splice(autoIndex, 1);
      } else {
        // 자동 핀 없으면 추가 불가
        return false;
      }
    }
  }

  session.pinnedContexts.push({
    text,
    createdAt: Date.now(),
    source,
  });

  console.log(`[Pin] chatId=${chatId} added pin (${source}): ${text.slice(0, 50)}...`);
  return true;
}

/**
 * 핀 제거
 */
export function unpinContext(chatId: number, index: number): boolean {
  const session = getSession(chatId);
  if (index >= 0 && index < session.pinnedContexts.length) {
    session.pinnedContexts.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * 모든 핀 제거
 */
export function clearPins(chatId: number): void {
  getSession(chatId).pinnedContexts = [];
}

/**
 * 요약 청크 추가
 */
export function addSummaryChunk(chatId: number, chunk: SummaryChunk): void {
  const session = getSession(chatId);
  session.summaryChunks.push(chunk);
  
  // 오래된 요약은 병합
  while (session.summaryChunks.length > MESSAGES.MAX_SUMMARY_CHUNKS) {
    const [first, second] = session.summaryChunks.splice(0, 2);
    session.summaryChunks.unshift({
      summary: `${first.summary}\n\n${second.summary}`,
      messageCount: first.messageCount + second.messageCount,
      startTime: first.startTime,
      endTime: second.endTime,
    });
  }
}

/**
 * 개선된 히스토리 트리밍
 * 
 * 전략:
 * 1. 최근 N개 메시지는 반드시 유지
 * 2. 토큰이 임계치 초과하면 오래된 메시지 제거 (요약 청크로 변환 가능)
 * 3. 핀된 맥락은 별도로 보존됨 (여기서 처리 안 함)
 */
export function trimHistoryByTokens(history: Message[] | null | undefined): void {
  if (!history || history.length === 0) {
    return;
  }

  const currentTokens = estimateMessagesTokens(history);
  
  // 한도 이내면 패스
  if (currentTokens <= TOKENS.MAX_HISTORY) {
    return;
  }

  console.log(`[Trim] Starting trim: ${currentTokens} tokens, ${history.length} messages`);

  // 최근 메시지는 반드시 유지
  while (estimateMessagesTokens(history) > TOKENS.MAX_HISTORY && history.length > MESSAGES.MIN_RECENT) {
    history.shift();
  }

  const afterTokens = estimateMessagesTokens(history);
  console.log(`[Trim] After trim: ${afterTokens} tokens, ${history.length} messages`);
}

/**
 * 스마트 트리밍 - 요약과 함께 수행
 * 
 * @param chatId 채팅 ID
 * @param summarizeFn 요약 함수 (외부 주입 - API 호출 필요)
 * @returns 요약이 수행되었는지 여부
 */
export async function smartTrimHistory(
  chatId: number,
  summarizeFn?: (messages: Message[]) => Promise<string>
): Promise<boolean> {
  const session = getSession(chatId);
  const history = session.history;

  if (!history || history.length === 0) {
    return false;
  }

  const currentTokens = estimateMessagesTokens(history);

  // 요약 임계치 이하면 패스
  if (currentTokens <= TOKENS.SUMMARY_THRESHOLD) {
    return false;
  }

  // 요약 함수가 없으면 기본 트리밍만
  if (!summarizeFn) {
    trimHistoryByTokens(history);
    return false;
  }

  console.log(`[SmartTrim] chatId=${chatId} tokens=${currentTokens}, starting summarization...`);

  // 오래된 메시지들 (최근 N개 제외)
  const toSummarize = history.slice(0, -MESSAGES.MIN_RECENT);
  const toKeep = history.slice(-MESSAGES.MIN_RECENT);

  if (toSummarize.length < 4) {
    // 요약할 게 별로 없으면 기본 트리밍
    trimHistoryByTokens(history);
    return false;
  }

  try {
    const summary = await summarizeFn(toSummarize);

    // 요약 청크 저장
    addSummaryChunk(chatId, {
      summary,
      messageCount: toSummarize.length,
      startTime: Date.now() - (toSummarize.length * 60000), // 대략적인 시간
      endTime: Date.now(),
    });

    // 히스토리 교체: [요약 메시지] + [최근 메시지들]
    history.splice(0, history.length);
    history.push({ 
      role: "user", 
      content: `[이전 대화 요약]\n${summary}` 
    });
    history.push({ 
      role: "assistant", 
      content: "네, 이전 대화 내용을 기억하고 있어요." 
    });
    history.push(...toKeep);

    const afterTokens = estimateMessagesTokens(history);
    console.log(`[SmartTrim] chatId=${chatId} summarized: ${currentTokens} → ${afterTokens} tokens`);

    return true;
  } catch (error) {
    console.error(`[SmartTrim] Failed to summarize:`, error);
    // 실패하면 기본 트리밍으로 폴백
    trimHistoryByTokens(history);
    return false;
  }
}

/**
 * 중요 맥락 자동 감지
 * 
 * 패턴:
 * - "기억해", "잊지 마", "remember"
 * - 이름, 선호도, 중요 정보 언급
 * - 명시적 핀 요청
 */
export function detectImportantContext(message: string): string | null {
  const patterns = [
    /기억해[줘요]?\s*[:：]?\s*(.+)/i,
    /잊지\s*마[줘요]?\s*[:：]?\s*(.+)/i,
    /remember\s*[:：]?\s*(.+)/i,
    /내\s*이름은?\s+(.+?)(?:이야|야|입니다|예요|요)?[.!]?\s*$/i,
    /나는?\s+(.+?)(?:을|를)?\s*(?:좋아해|싫어해|선호해)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * 시스템 프롬프트용 맥락 문자열 생성
 */
export function buildContextForPrompt(chatId: number): string {
  const session = getSession(chatId);
  const parts: string[] = [];

  // 핀된 맥락
  if (session.pinnedContexts.length > 0) {
    parts.push("## 📌 중요 맥락 (사용자가 기억해달라고 한 것들)");
    session.pinnedContexts.forEach((p, i) => {
      parts.push(`${i + 1}. ${p.text}`);
    });
  }

  // 요약 청크 (있으면)
  if (session.summaryChunks.length > 0) {
    parts.push("\n## 📜 이전 대화 요약");
    session.summaryChunks.forEach((chunk) => {
      parts.push(`- ${chunk.summary}`);
    });
  }

  return parts.join("\n");
}

export function clearHistory(chatId: number): void {
  const session = sessions.get(chatId);
  if (session) {
    session.history = [];
    session.summaryChunks = [];
    // 핀은 유지 (중요 맥락이므로)
  }
}

/**
 * 완전 초기화 (핀 포함 + JSONL 파일 삭제)
 */
export function clearSession(chatId: number): void {
  sessions.delete(chatId);
  persistence.deleteSessionFile(chatId);
}

export function getModel(chatId: number): ModelId {
  return getSession(chatId).model;
}

export function setModel(chatId: number, modelId: ModelId): void {
  getSession(chatId).model = modelId;
}

export function getThinkingLevel(chatId: number): ThinkingLevel {
  return getSession(chatId).thinkingLevel;
}

export function setThinkingLevel(chatId: number, level: ThinkingLevel): void {
  getSession(chatId).thinkingLevel = level;
}

export function runWithChatId<T>(chatId: number, fn: () => T): T {
  return chatIdStorage.run(chatId, fn);
}

export function getCurrentChatId(): number | null {
  return chatIdStorage.getStore() ?? null;
}

export function cleanupExpiredSessions(): number {
  const before = sessions.size;
  cleanupSessions();
  return before - sessions.size;
}

export function getSessionCount(): number {
  return sessions.size;
}

/**
 * 세션 통계 (디버그용)
 */
export function getSessionStats(chatId: number): {
  historyLength: number;
  historyTokens: number;
  pinnedCount: number;
  pinnedTokens: number;
  summaryCount: number;
  totalPersistedCount: number;
} {
  const session = getSession(chatId);
  return {
    historyLength: session.history.length,
    historyTokens: estimateMessagesTokens(session.history),
    pinnedCount: session.pinnedContexts.length,
    pinnedTokens: session.pinnedContexts.reduce(
      (sum, p) => sum + estimateTokens(p.text),
      0
    ),
    summaryCount: session.summaryChunks.length,
    totalPersistedCount: persistence.getHistoryCount(chatId),
  };
}

// Re-export persistence functions for external use
export {
  searchHistory,
  getHistoryCount,
  sessionFileExists,
  listSessionFiles,
} from "./persistence.js";
