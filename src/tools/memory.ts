/**
 * Memory-related tools
 */

import { getCurrentChatId } from "../session/state.js";
import {
  getWorkspacePath,
  saveWorkspaceFile,
  appendToMemory,
  deleteBootstrap,
} from "../workspace/index.js";
import { ensureDefaultCronJobs } from "../cron/index.js";
import { embed } from '../memory/embeddings.js';
import { search } from '../memory/vectorStore.js';
import { reindexAll } from '../memory/indexer.js';

// save_memory
export async function executeSaveMemory(input: Record<string, unknown>): Promise<string> {
  const content = input.content as string;
  const category = (input.category as string) || "other";

  await appendToMemory(`[${category}] ${content}`);
  return `Memory saved: ${content.slice(0, 50)}...`;
}

// save_persona
export async function executeSavePersona(input: Record<string, unknown>): Promise<string> {
  const identity = input.identity as string;
  const soul = input.soul as string;
  const user = input.user as string;

  // 각 파일 저장
  await saveWorkspaceFile("IDENTITY.md", identity);
  await saveWorkspaceFile("SOUL.md", soul);
  await saveWorkspaceFile("USER.md", user);

  // BOOTSTRAP.md 삭제
  await deleteBootstrap();

  // 기본 cron jobs 설정 (매일 12시 메모리 저장 등)
  const chatId = getCurrentChatId();
  if (chatId) {
    await ensureDefaultCronJobs(chatId);
  }

  return "Persona saved! BOOTSTRAP mode complete. I'm ready to chat with my new identity.";
}

// memory_search
export async function executeMemorySearch(input: Record<string, unknown>): Promise<string> {
  const query = input.query as string;
  const limit = (input.limit as number) || 5;
  const minScore = (input.minScore as number) || 0.3;
  
  const queryEmbedding = await embed(query);
  const results = await search(queryEmbedding, limit, minScore);
  
  if (results.length === 0) {
    return "관련 기억을 찾지 못했어.";
  }
  
  return results.map((r, i) => 
    `[${i + 1}] (${r.source}, score: ${r.score.toFixed(2)})\n${r.text}`
  ).join('\n\n---\n\n');
}

// memory_reindex
export async function executeMemoryReindex(): Promise<string> {
  const result = await reindexAll();
  const sourceList = result.sources.length > 5 
    ? result.sources.slice(0, 5).join(', ') + ` 외 ${result.sources.length - 5}개`
    : result.sources.join(', ');
  return `리인덱싱 완료: 총 ${result.total}개 청크 (소스: ${sourceList || '없음'})`;
}
