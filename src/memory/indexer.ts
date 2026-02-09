/**
 * 메모리 인덱서 모듈
 * 벡터 저장소와 FTS 인덱스 모두 업데이트합니다.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { invalidateCache, loadAllMemoryChunks } from "./vectorStore.js";
import { indexTextBatch, clearIndex as clearFtsIndex, getDocumentCount, type FtsEntry } from "./ftsIndex.js";
import { getMemoryDirPath, getWorkspaceFilePath } from "../workspace/paths.js";

/**
 * 텍스트를 청크로 분할합니다.
 */
function splitIntoChunks(text: string, source: string): Array<{ id: string; text: string; source: string }> {
  const chunks: Array<{ id: string; text: string; source: string }> = [];
  let chunkIndex = 0;

  // ## 헤더로 분할
  const sections = text.split(/(?=^## )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.length < 20) continue;

    // 청크가 너무 길면 추가로 분할
    if (trimmed.length > 500) {
      const lines = trimmed.split("\n");
      let currentChunk = "";

      for (const line of lines) {
        if (currentChunk.length + line.length > 500) {
          if (currentChunk.trim()) {
            chunks.push({
              id: `${source}:${chunkIndex++}`,
              text: currentChunk.trim(),
              source,
            });
          }
          currentChunk = line;
        } else {
          currentChunk += "\n" + line;
        }
      }

      if (currentChunk.trim()) {
        chunks.push({
          id: `${source}:${chunkIndex++}`,
          text: currentChunk.trim(),
          source,
        });
      }
    } else {
      chunks.push({
        id: `${source}:${chunkIndex++}`,
        text: trimmed,
        source,
      });
    }
  }

  return chunks;
}

/**
 * 단일 파일 인덱싱 (캐시 무효화 + FTS 업데이트)
 */
export async function indexFile(filePath: string, source: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const chunks = splitIntoChunks(content, source);

    // FTS 인덱스 업데이트
    const ftsEntries: FtsEntry[] = chunks.map(c => ({
      id: c.id,
      source: c.source,
      text: c.text,
    }));
    indexTextBatch(ftsEntries);

    // 벡터 캐시 무효화
    invalidateCache();

    return chunks.length;
  } catch {
    return 0;
  }
}

/**
 * MEMORY.md 인덱싱
 */
export async function indexMainMemory(): Promise<number> {
  const memoryPath = getWorkspaceFilePath("MEMORY.md");
  return indexFile(memoryPath, "MEMORY");
}

/**
 * 일일 메모리 파일들 인덱싱
 */
export async function indexDailyMemories(days: number = 30): Promise<number> {
  const memoryDir = getMemoryDirPath();
  let totalChunks = 0;

  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files
      .filter(f => f.endsWith(".md") && !f.startsWith("."))
      .sort()
      .reverse()
      .slice(0, days);

    for (const file of mdFiles) {
      const filePath = path.join(memoryDir, file);
      const source = file.replace(".md", "");
      const count = await indexFile(filePath, source);
      totalChunks += count;
    }
  } catch {
    // 디렉토리 없음 무시
  }

  return totalChunks;
}

/**
 * 대화 기록 인덱싱 (JSONL 형식)
 */
export async function indexConversation(
  conversationId: string,
  messages: Array<{ role: string; content: string; timestamp?: number }>
): Promise<number> {
  if (messages.length === 0) return 0;

  const ftsEntries: FtsEntry[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg.content || msg.content.length < 10) continue;

    ftsEntries.push({
      id: `conv:${conversationId}:${i}`,
      source: `conversation:${conversationId}`,
      text: `[${msg.role}] ${msg.content}`,
    });
  }

  if (ftsEntries.length > 0) {
    indexTextBatch(ftsEntries);
  }

  return ftsEntries.length;
}

/**
 * 전체 리인덱싱 (벡터 + FTS 모두)
 */
export async function reindexAll(): Promise<{ total: number; sources: string[]; ftsCount: number }> {
  console.log("[Indexer] Starting full reindex...");

  // 1. FTS 인덱스 초기화
  clearFtsIndex();

  // 2. 벡터 캐시 무효화 및 로드
  invalidateCache();
  const chunks = await loadAllMemoryChunks();

  // 3. 모든 청크를 FTS에 인덱싱
  const ftsEntries: FtsEntry[] = chunks.map((chunk, idx) => ({
    id: `${chunk.source}:${idx}`,
    source: chunk.source,
    text: chunk.text,
  }));

  if (ftsEntries.length > 0) {
    indexTextBatch(ftsEntries);
  }

  // 4. 소스별 집계
  const sourceCounts = new Map<string, number>();
  for (const chunk of chunks) {
    sourceCounts.set(chunk.source, (sourceCounts.get(chunk.source) || 0) + 1);
  }

  const ftsCount = getDocumentCount();
  console.log(`[Indexer] Indexed ${chunks.length} chunks to vector store, ${ftsCount} documents to FTS`);

  return {
    total: chunks.length,
    sources: Array.from(sourceCounts.keys()),
    ftsCount,
  };
}
