/**
 * JSONL 기반 세션 영구 저장
 * 
 * OpenClaw 스타일로 대화 기록을 JSONL 파일로 저장
 * - 저장 경로: ~/.companionbot/sessions/{chatId}.jsonl
 * - 메시지마다 한 줄씩 append
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// 저장 경로
const SESSIONS_DIR = path.join(os.homedir(), ".companionbot", "sessions");

// JSONL 메시지 형식
export type PersistedMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

/**
 * 세션 디렉토리 초기화 (없으면 생성)
 */
function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    console.log(`[Persistence] Created sessions directory: ${SESSIONS_DIR}`);
  }
}

/**
 * chatId에 해당하는 JSONL 파일 경로
 */
function getSessionFilePath(chatId: number): string {
  return path.join(SESSIONS_DIR, `${chatId}.jsonl`);
}

/**
 * 메시지를 JSONL 파일에 append
 */
export function appendMessage(chatId: number, role: "user" | "assistant", content: string): void {
  ensureSessionsDir();
  
  const filePath = getSessionFilePath(chatId);
  const message: PersistedMessage = {
    role,
    content,
    timestamp: Date.now(),
  };
  
  const line = JSON.stringify(message) + "\n";
  
  try {
    fs.appendFileSync(filePath, line, "utf-8");
  } catch (error) {
    console.error(`[Persistence] Failed to append message to ${filePath}:`, error);
  }
}

/**
 * JSONL 파일에서 히스토리 로드
 * 
 * @param chatId 채팅 ID
 * @param limit 최근 N개만 로드 (메모리 절약, 0 = 전부)
 * @returns 로드된 메시지 배열
 */
export async function loadHistory(chatId: number, limit: number = 100): Promise<PersistedMessage[]> {
  const filePath = getSessionFilePath(chatId);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const messages: PersistedMessage[] = [];
  
  try {
    const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line) as PersistedMessage;
          messages.push(msg);
        } catch (parseError) {
          console.warn(`[Persistence] Skipping malformed line in ${filePath}`);
        }
      }
    }
  } catch (error) {
    console.error(`[Persistence] Failed to load history from ${filePath}:`, error);
    return [];
  }
  
  // limit이 0이면 전부, 아니면 최근 N개만
  if (limit > 0 && messages.length > limit) {
    return messages.slice(-limit);
  }
  
  return messages;
}

/**
 * 동기 버전 히스토리 로드 (초기화 시 사용)
 */
export function loadHistorySync(chatId: number, limit: number = 100): PersistedMessage[] {
  const filePath = getSessionFilePath(chatId);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const messages: PersistedMessage[] = [];
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line) as PersistedMessage;
          messages.push(msg);
        } catch (parseError) {
          console.warn(`[Persistence] Skipping malformed line in ${filePath}`);
        }
      }
    }
  } catch (error) {
    console.error(`[Persistence] Failed to load history from ${filePath}:`, error);
    return [];
  }
  
  // limit이 0이면 전부, 아니면 최근 N개만
  if (limit > 0 && messages.length > limit) {
    return messages.slice(-limit);
  }
  
  return messages;
}

/**
 * 전체 히스토리 개수 (파일에서)
 */
export function getHistoryCount(chatId: number): number {
  const filePath = getSessionFilePath(chatId);
  
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * 세션 파일 삭제 (히스토리 완전 삭제)
 */
export function deleteSessionFile(chatId: number): boolean {
  const filePath = getSessionFilePath(chatId);
  
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    fs.unlinkSync(filePath);
    console.log(`[Persistence] Deleted session file: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[Persistence] Failed to delete session file:`, error);
    return false;
  }
}

/**
 * 세션 파일 존재 여부
 */
export function sessionFileExists(chatId: number): boolean {
  return fs.existsSync(getSessionFilePath(chatId));
}

/**
 * 모든 세션 파일 목록
 */
export function listSessionFiles(): number[] {
  ensureSessionsDir();
  
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    return files
      .filter(f => f.endsWith(".jsonl"))
      .map(f => parseInt(f.replace(".jsonl", ""), 10))
      .filter(id => !isNaN(id));
  } catch {
    return [];
  }
}

/**
 * 히스토리 검색 (파일 전체에서)
 * 
 * @param chatId 채팅 ID
 * @param query 검색어
 * @param limit 최대 결과 수
 * @returns 매칭된 메시지들
 */
export async function searchHistory(
  chatId: number,
  query: string,
  limit: number = 10
): Promise<PersistedMessage[]> {
  const all = await loadHistory(chatId, 0); // 전부 로드
  const lowerQuery = query.toLowerCase();
  
  const matches = all
    .filter(msg => msg.content.toLowerCase().includes(lowerQuery))
    .slice(-limit); // 최근 것부터
  
  return matches;
}
