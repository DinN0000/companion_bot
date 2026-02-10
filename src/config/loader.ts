/**
 * config.yaml 로더
 * 
 * 우선순위: config.yaml > config.example.yaml > 기본값
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import type { ModelId, ThinkingLevel } from "../ai/claude.js";

// ============================================
// 타입 정의
// ============================================

export interface Config {
  // 모델 설정
  model: {
    default: ModelId;
    thinking: ThinkingLevel;
  };

  // 토큰/컨텍스트 설정
  tokens: {
    maxContext: number;
    maxHistory: number;
    summaryThreshold: number;
    maxPinned: number;
    compactionThreshold: number;
    compactMinTokens: number;
  };

  // 세션 설정
  session: {
    maxSessions: number;
    ttlHours: number;
    maxHistoryLoad: number;
  };

  // 메시지 설정
  messages: {
    minRecent: number;
    keepOnCompact: number;
    maxSummaryChunks: number;
    searchLimit: number;
    historyLoadLimit: number;
  };

  // 메모리/벡터 설정
  memory: {
    cacheTtlMinutes: number;
    minChunkLength: number;
    maxChunkLength: number;
    recentDays: number;
    searchTopK: number;
    minSimilarity: number;
    displayDays: number;
    maxDisplayLength: number;
  };

  // 텔레그램 설정
  telegram: {
    maxMessageLength: number;
    maxImageSizeMb: number;
    maxUrlFetch: number;
    calendarPreviewCount: number;
    typingRefreshMs: number;
  };

  // API 설정
  api: {
    timeoutMs: number;
    maxRetries: number;
    initialRetryDelayMs: number;
    maxRetryDelayMs: number;
    backoffMultiplier: number;
  };

  // 검색 설정
  search: {
    timeoutMs: number;
    embedTimeoutMs: number;
  };

  // 보안 설정
  security: {
    resetTokenTtlMs: number;
  };
}

// ============================================
// 기본값 (OpenClaw 수준)
// ============================================

const DEFAULT_CONFIG: Config = {
  model: {
    default: "opus",
    thinking: "medium",
  },

  tokens: {
    maxContext: 200000,
    maxHistory: 80000,
    summaryThreshold: 50000,
    maxPinned: 10000,
    compactionThreshold: 0.50,
    compactMinTokens: 5000,
  },

  session: {
    maxSessions: 100,
    ttlHours: 24,
    maxHistoryLoad: 50,
  },

  messages: {
    minRecent: 6,
    keepOnCompact: 4,
    maxSummaryChunks: 3,
    searchLimit: 10,
    historyLoadLimit: 100,
  },

  memory: {
    cacheTtlMinutes: 5,
    minChunkLength: 20,
    maxChunkLength: 500,
    recentDays: 30,
    searchTopK: 5,
    minSimilarity: 0.3,
    displayDays: 7,
    maxDisplayLength: 2000,
  },

  telegram: {
    maxMessageLength: 4096,
    maxImageSizeMb: 10,
    maxUrlFetch: 3,
    calendarPreviewCount: 3,
    typingRefreshMs: 4000,
  },

  api: {
    timeoutMs: 120000,
    maxRetries: 3,
    initialRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
    backoffMultiplier: 2,
  },

  search: {
    timeoutMs: 5000,
    embedTimeoutMs: 3000,
  },

  security: {
    resetTokenTtlMs: 60000,
  },
};

// ============================================
// 로더
// ============================================

let loadedConfig: Config | null = null;

/**
 * 깊은 병합 (nested object 지원)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: Config, source: unknown): Config {
  if (!source || typeof source !== "object") return target;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = JSON.parse(JSON.stringify(target));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const src = source as any;
  
  for (const key of Object.keys(src)) {
    if (!(key in result)) continue;
    
    const sourceValue = src[key];
    const targetValue = result[key];
    
    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      // 중첩 객체 병합
      result[key] = { ...targetValue, ...sourceValue };
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }
  
  return result as Config;
}

/**
 * config.yaml 로드
 */
export function loadConfig(configDir?: string): Config {
  if (loadedConfig) return loadedConfig;

  const baseDir = configDir ?? process.cwd();
  const configPath = join(baseDir, "config.yaml");
  const examplePath = join(baseDir, "config.example.yaml");

  let userConfig: unknown = {};

  // config.yaml 우선
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      userConfig = yaml.load(content);
      console.log("[Config] Loaded: config.yaml");
    } catch (err) {
      console.error("[Config] Failed to parse config.yaml:", err);
    }
  } 
  // config.example.yaml 폴백
  else if (existsSync(examplePath)) {
    try {
      const content = readFileSync(examplePath, "utf-8");
      userConfig = yaml.load(content);
      console.log("[Config] Loaded: config.example.yaml (create config.yaml to customize)");
    } catch (err) {
      console.error("[Config] Failed to parse config.example.yaml:", err);
    }
  } else {
    console.log("[Config] No config file found, using defaults");
  }

  // 기본값과 병합
  loadedConfig = deepMerge(DEFAULT_CONFIG, userConfig);
  
  // 로드된 주요 설정 로깅
  console.log(`[Config] model=${loadedConfig.model.default}, thinking=${loadedConfig.model.thinking}`);

  return loadedConfig;
}

/**
 * 현재 설정 가져오기 (로드 안 됐으면 자동 로드)
 */
export function getConfig(): Config {
  if (!loadedConfig) {
    return loadConfig();
  }
  return loadedConfig;
}

/**
 * 설정 리로드 (테스트/개발용)
 */
export function reloadConfig(configDir?: string): Config {
  loadedConfig = null;
  return loadConfig(configDir);
}
