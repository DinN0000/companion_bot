/**
 * 재사용 가능한 재시도/타임아웃/에러 처리 유틸리티
 */

import { APIError } from "@anthropic-ai/sdk";
import { sleep } from "./time.js";

// ============== 설정 ==============

export interface RetryOptions {
  /** 최대 재시도 횟수 */
  maxRetries?: number;
  /** 초기 지연 시간 (ms) */
  initialDelayMs?: number;
  /** 최대 지연 시간 (ms) */
  maxDelayMs?: number;
  /** 지수 백오프 배수 */
  backoffMultiplier?: number;
  /** 재시도할 에러 판단 함수 */
  shouldRetry?: (error: unknown) => boolean;
  /** 재시도 시 로깅 */
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "onRetry" | "shouldRetry">> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

// ============== 재시도 가능 에러 판단 ==============

/**
 * 네트워크/일시적 에러인지 판단
 */
export function isTransientError(error: unknown): boolean {
  // Anthropic API 에러
  if (error instanceof APIError) {
    // Rate limit
    if (error.status === 429) return true;
    // Server errors (일시적)
    if (error.status >= 500 && error.status < 600) return true;
    // Timeout
    if (error.status === 408) return true;
    // Bad Gateway, Service Unavailable
    if (error.status === 502 || error.status === 503 || error.status === 504) return true;
    return false;
  }

  // 일반 Error - 메시지로 판단
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    
    // 네트워크 에러
    if (msg.includes("econnreset")) return true;
    if (msg.includes("econnrefused")) return true;
    if (msg.includes("etimedout")) return true;
    if (msg.includes("enotfound")) return true;
    if (msg.includes("epipe")) return true;
    if (msg.includes("socket hang up")) return true;
    if (msg.includes("network")) return true;
    
    // 타임아웃
    if (msg.includes("timeout")) return true;
    if (msg.includes("timed out")) return true;
    
    // 일시적 실패
    if (msg.includes("temporarily unavailable")) return true;
    if (msg.includes("try again")) return true;
    if (msg.includes("rate limit")) return true;
    if (msg.includes("429")) return true;
  }

  return false;
}

/**
 * Rate limit 에러인지 판단
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof APIError && error.status === 429) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests");
  }
  return false;
}

/**
 * Rate limit 에러에서 retry-after 헤더 추출 (ms)
 */
export function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof APIError && error.status === 429) {
    const retryAfter = error.headers?.["retry-after"];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  return null;
}

// ============== 재시도 함수 ==============

/**
 * 지수 백오프로 함수를 재시도합니다.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const shouldRetry = opts.shouldRetry ?? isTransientError;
  
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 마지막 시도거나 재시도 불가능한 에러면 즉시 throw
      if (attempt >= opts.maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Rate limit은 retry-after 헤더 우선
      const retryAfter = getRetryAfterMs(error);
      const actualDelay = retryAfter ?? delay;
      const cappedDelay = Math.min(actualDelay, opts.maxDelayMs);

      // 로깅 콜백
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, error, cappedDelay);
      }

      await sleep(cappedDelay);
      
      // 다음 지연 시간 계산 (rate limit이 아닌 경우)
      if (!retryAfter) {
        delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
      }
    }
  }

  throw lastError;
}

// ============== 타임아웃 ==============

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * 함수에 타임아웃을 적용합니다.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(
          errorMessage ?? `Operation timed out after ${timeoutMs}ms`,
          timeoutMs
        ));
      }, timeoutMs);
    }),
  ]);
}

/**
 * 재시도 + 타임아웃을 함께 적용합니다.
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retryOptions: RetryOptions = {}
): Promise<T> {
  return withRetry(
    () => withTimeout(fn, timeoutMs),
    {
      ...retryOptions,
      // 타임아웃 에러도 재시도 가능하도록
      shouldRetry: (error) => {
        if (error instanceof TimeoutError) return true;
        return (retryOptions.shouldRetry ?? isTransientError)(error);
      },
    }
  );
}

// ============== 부분 실패 처리 ==============

export interface FallbackResult<T> {
  value: T;
  error?: Error;
  usedFallback: boolean;
}

/**
 * 주 함수 실패 시 폴백 값을 반환합니다.
 * 에러는 로깅만 하고 삼킵니다.
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  options?: {
    onError?: (error: unknown) => void;
    /** true면 에러도 함께 반환 */
    returnError?: boolean;
  }
): Promise<T | FallbackResult<T>> {
  try {
    const value = await fn();
    if (options?.returnError) {
      return { value, usedFallback: false };
    }
    return value;
  } catch (error) {
    if (options?.onError) {
      options.onError(error);
    }
    if (options?.returnError) {
      return {
        value: fallback,
        error: error instanceof Error ? error : new Error(String(error)),
        usedFallback: true,
      };
    }
    return fallback;
  }
}

/**
 * 여러 소스 중 하나라도 성공하면 반환합니다.
 * 모두 실패하면 마지막 에러를 throw합니다.
 */
export async function withFirstSuccess<T>(
  fns: (() => Promise<T>)[],
  options?: {
    onError?: (error: unknown, index: number) => void;
  }
): Promise<T> {
  let lastError: unknown;
  
  for (let i = 0; i < fns.length; i++) {
    try {
      return await fns[i]();
    } catch (error) {
      lastError = error;
      if (options?.onError) {
        options.onError(error, i);
      }
    }
  }
  
  throw lastError;
}

// ============== 사용자 친화적 에러 메시지 ==============

export interface UserFriendlyError {
  userMessage: string;
  technicalMessage: string;
  isRetryable: boolean;
  suggestedAction?: string;
}

/**
 * 에러를 사용자 친화적 메시지로 변환합니다.
 */
export function toUserFriendlyError(error: unknown): UserFriendlyError {
  const technicalMessage = error instanceof Error ? error.message : String(error);
  const msg = technicalMessage.toLowerCase();

  // Rate Limit
  if (isRateLimitError(error)) {
    return {
      userMessage: "지금 요청이 많아서 잠깐 쉬어야 해.",
      technicalMessage,
      isRetryable: true,
      suggestedAction: "30초 후에 다시 시도해줄래?",
    };
  }

  // Timeout
  if (error instanceof TimeoutError || msg.includes("timeout") || msg.includes("timed out")) {
    return {
      userMessage: "응답이 너무 오래 걸려서 중단됐어.",
      technicalMessage,
      isRetryable: true,
      suggestedAction: "다시 시도해줄래?",
    };
  }

  // Network errors
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("network")) {
    return {
      userMessage: "네트워크 연결에 문제가 생겼어.",
      technicalMessage,
      isRetryable: true,
      suggestedAction: "인터넷 연결을 확인하고 다시 시도해줄래?",
    };
  }

  // Context length
  if (msg.includes("context_length") || msg.includes("too many tokens") || msg.includes("maximum context")) {
    return {
      userMessage: "대화가 너무 길어졌어.",
      technicalMessage,
      isRetryable: false,
      suggestedAction: "/compact 로 정리하고 다시 시도해줘!",
    };
  }

  // Auth errors
  if (msg.includes("unauthorized") || msg.includes("authentication") || msg.includes("api key")) {
    return {
      userMessage: "인증에 문제가 생겼어.",
      technicalMessage,
      isRetryable: false,
      suggestedAction: "관리자에게 문의해줘.",
    };
  }

  // Server errors
  if (msg.includes("internal server error") || msg.includes("500") || msg.includes("502") || msg.includes("503")) {
    return {
      userMessage: "서버에 일시적인 문제가 생겼어.",
      technicalMessage,
      isRetryable: true,
      suggestedAction: "잠시 후 다시 시도해줄래?",
    };
  }

  // Default
  return {
    userMessage: "문제가 생겼어.",
    technicalMessage,
    isRetryable: isTransientError(error),
    suggestedAction: isTransientError(error) ? "다시 시도해줄래?" : undefined,
  };
}

/**
 * 에러를 사용자에게 보여줄 문자열로 변환합니다.
 */
export function formatErrorForUser(error: unknown, showTechnical = true): string {
  const friendly = toUserFriendlyError(error);
  let msg = friendly.userMessage;
  
  // 기술적 에러 정보 추가 (디버깅용)
  if (showTechnical && friendly.technicalMessage) {
    const shortTech = friendly.technicalMessage.slice(0, 100);
    msg += `\n\n🔧 상세: ${shortTech}${friendly.technicalMessage.length > 100 ? "..." : ""}`;
  }
  
  return msg;
}
