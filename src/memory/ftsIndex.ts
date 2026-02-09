/**
 * FTS5 기반 키워드 검색 인덱스 모듈
 * SQLite FTS5를 사용하여 전문 검색을 제공합니다.
 */

import Database from "better-sqlite3";
import * as path from "path";
import { getMemoryDirPath } from "../workspace/paths.js";

// 싱글톤 DB 인스턴스
let db: Database.Database | null = null;

/**
 * FTS5 데이터베이스 경로
 */
function getDbPath(): string {
  return path.join(getMemoryDirPath(), ".fts-index.db");
}

/**
 * 데이터베이스 인스턴스를 가져오거나 생성합니다.
 */
function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // FTS5 테이블 생성 (없으면)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id,
      source,
      text,
      content='',
      tokenize='unicode61'
    );
  `);

  return db;
}

export interface FtsEntry {
  id: string;
  source: string;
  text: string;
}

export interface FtsSearchResult {
  id: string;
  source: string;
  text: string;
  score: number;  // BM25 점수 (낮을수록 관련성 높음)
}

/**
 * 텍스트를 FTS 인덱스에 추가합니다.
 * 기존 id가 있으면 업데이트합니다.
 */
export function indexText(id: string, source: string, text: string): void {
  const database = getDb();

  // 기존 엔트리 삭제 후 삽입 (upsert)
  const deleteStmt = database.prepare(
    "DELETE FROM memory_fts WHERE id = ?"
  );
  const insertStmt = database.prepare(
    "INSERT INTO memory_fts (id, source, text) VALUES (?, ?, ?)"
  );

  const transaction = database.transaction(() => {
    deleteStmt.run(id);
    insertStmt.run(id, source, text);
  });

  transaction();
}

/**
 * 여러 텍스트를 배치로 인덱싱합니다.
 */
export function indexTextBatch(entries: FtsEntry[]): void {
  if (entries.length === 0) return;

  const database = getDb();
  const deleteStmt = database.prepare(
    "DELETE FROM memory_fts WHERE id = ?"
  );
  const insertStmt = database.prepare(
    "INSERT INTO memory_fts (id, source, text) VALUES (?, ?, ?)"
  );

  const transaction = database.transaction(() => {
    for (const entry of entries) {
      deleteStmt.run(entry.id);
      insertStmt.run(entry.id, entry.source, entry.text);
    }
  });

  transaction();
}

/**
 * 키워드로 검색합니다.
 * FTS5 MATCH 쿼리와 BM25 랭킹 사용
 */
export function searchKeyword(query: string, limit: number = 10): FtsSearchResult[] {
  const database = getDb();

  // 쿼리 정규화 (특수문자 제거, 공백으로 분리)
  const cleanQuery = query
    .replace(/[^\w\s가-힣]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .map(word => `"${word}"`)  // 정확한 단어 매칭
    .join(" OR ");  // OR 검색

  if (!cleanQuery) return [];

  try {
    const stmt = database.prepare(`
      SELECT id, source, text, bm25(memory_fts) as score
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `);

    const results = stmt.all(cleanQuery, limit) as Array<{
      id: string;
      source: string;
      text: string;
      score: number;
    }>;

    return results.map(r => ({
      id: r.id,
      source: r.source,
      text: r.text,
      score: r.score,
    }));
  } catch {
    // 쿼리 파싱 실패 시 빈 결과
    return [];
  }
}

/**
 * 특정 소스의 모든 엔트리를 삭제합니다.
 */
export function deleteBySource(source: string): number {
  const database = getDb();
  const stmt = database.prepare("DELETE FROM memory_fts WHERE source = ?");
  const result = stmt.run(source);
  return result.changes;
}

/**
 * 특정 ID의 엔트리를 삭제합니다.
 */
export function deleteById(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare("DELETE FROM memory_fts WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * 전체 인덱스를 초기화합니다.
 */
export function clearIndex(): void {
  const database = getDb();
  database.exec("DELETE FROM memory_fts");
}

/**
 * 인덱스의 총 문서 수를 반환합니다.
 */
export function getDocumentCount(): number {
  const database = getDb();
  const stmt = database.prepare("SELECT COUNT(*) as count FROM memory_fts");
  const result = stmt.get() as { count: number };
  return result.count;
}

/**
 * 데이터베이스 연결을 닫습니다.
 * 애플리케이션 종료 시 호출
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
