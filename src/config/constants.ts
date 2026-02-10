/**
 * 전역 상수 설정
 * config.yaml에서 값을 가져옴 (없으면 기본값 사용)
 */

import { getConfig } from "./loader.js";

// 설정 로드 (lazy)
const config = () => getConfig();

// ============================================
// 세션 관련 설정
// ============================================
export const SESSION = {
  get MAX_SESSIONS() { return config().session.maxSessions; },
  get TTL_MS() { return config().session.ttlHours * 60 * 60 * 1000; },
  get MAX_HISTORY_LOAD() { return config().session.maxHistoryLoad; },
} as const;

// ============================================
// 토큰/컨텍스트 관련 설정
// ============================================
export const TOKENS = {
  get MAX_CONTEXT() { return config().tokens.maxContext; },
  get MAX_HISTORY() { return config().tokens.maxHistory; },
  get SUMMARY_THRESHOLD() { return config().tokens.summaryThreshold; },
  get MAX_PINNED() { return config().tokens.maxPinned; },
  get COMPACTION_THRESHOLD() { return config().tokens.compactionThreshold; },
  get COMPACT_MIN_TOKENS() { return config().tokens.compactMinTokens; },
} as const;

// ============================================
// 메시지 관련 설정
// ============================================
export const MESSAGES = {
  get MIN_RECENT() { return config().messages.minRecent; },
  get KEEP_ON_COMPACT() { return config().messages.keepOnCompact; },
  get MAX_SUMMARY_CHUNKS() { return config().messages.maxSummaryChunks; },
  get SEARCH_LIMIT() { return config().messages.searchLimit; },
  get HISTORY_LOAD_LIMIT() { return config().messages.historyLoadLimit; },
} as const;

// ============================================
// 메모리/벡터 저장소 설정
// ============================================
export const MEMORY = {
  get CACHE_TTL_MS() { return config().memory.cacheTtlMinutes * 60 * 1000; },
  get MIN_CHUNK_LENGTH() { return config().memory.minChunkLength; },
  get MAX_CHUNK_LENGTH() { return config().memory.maxChunkLength; },
  get RECENT_DAYS() { return config().memory.recentDays; },
  get SEARCH_TOP_K() { return config().memory.searchTopK; },
  get MIN_SIMILARITY() { return config().memory.minSimilarity; },
  get DISPLAY_DAYS() { return config().memory.displayDays; },
  get MAX_DISPLAY_LENGTH() { return config().memory.maxDisplayLength; },
} as const;

// ============================================
// 텔레그램/UI 관련 설정
// ============================================
export const TELEGRAM = {
  get MAX_MESSAGE_LENGTH() { return config().telegram.maxMessageLength; },
  get MAX_IMAGE_SIZE() { return config().telegram.maxImageSizeMb * 1024 * 1024; },
  get MAX_URL_FETCH() { return config().telegram.maxUrlFetch; },
  get CALENDAR_PREVIEW_COUNT() { return config().telegram.calendarPreviewCount; },
  get TYPING_REFRESH_MS() { return config().telegram.typingRefreshMs; },
} as const;

// ============================================
// 보안/토큰 관련 설정
// ============================================
export const SECURITY = {
  get RESET_TOKEN_TTL_MS() { return config().security.resetTokenTtlMs; },
} as const;

// ============================================
// API/네트워크 설정
// ============================================
export const API = {
  get TIMEOUT_MS() { return config().api.timeoutMs; },
  get MAX_RETRIES() { return config().api.maxRetries; },
  get INITIAL_RETRY_DELAY_MS() { return config().api.initialRetryDelayMs; },
  get MAX_RETRY_DELAY_MS() { return config().api.maxRetryDelayMs; },
  get BACKOFF_MULTIPLIER() { return config().api.backoffMultiplier; },
} as const;

// ============================================
// 메모리 검색 타임아웃 설정
// ============================================
export const SEARCH = {
  get TIMEOUT_MS() { return config().search.timeoutMs; },
  get EMBED_TIMEOUT_MS() { return config().search.embedTimeoutMs; },
} as const;
