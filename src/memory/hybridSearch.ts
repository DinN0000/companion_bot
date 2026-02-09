/**
 * 하이브리드 검색 모듈
 * 벡터 검색 + 키워드 검색을 결합하여 최적의 검색 결과를 제공합니다.
 */

import { embed } from "./embeddings.js";
import { search as vectorSearch, type SearchResult } from "./vectorStore.js";
import { searchKeyword, type FtsSearchResult } from "./ftsIndex.js";

// 가중치 설정
const VECTOR_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;

export interface HybridSearchResult {
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

/**
 * BM25 점수를 0-1 범위로 정규화합니다.
 * BM25는 낮을수록 관련성이 높으므로 반전시킵니다.
 */
function normalizeBm25Score(score: number, minScore: number, maxScore: number): number {
  if (maxScore === minScore) return 1;
  // BM25는 음수 (낮을수록 좋음) → 정규화 후 반전
  const normalized = (maxScore - score) / (maxScore - minScore);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * 벡터 + 키워드 하이브리드 검색을 수행합니다.
 * 
 * @param query 검색 쿼리
 * @param topK 반환할 최대 결과 수
 * @param vectorWeight 벡터 검색 가중치 (기본 0.7)
 * @param keywordWeight 키워드 검색 가중치 (기본 0.3)
 */
export async function hybridSearch(
  query: string,
  topK: number = 5,
  vectorWeight: number = VECTOR_WEIGHT,
  keywordWeight: number = KEYWORD_WEIGHT
): Promise<HybridSearchResult[]> {
  // 병렬로 두 검색 수행
  const [queryEmbedding, keywordResults] = await Promise.all([
    embed(query),
    Promise.resolve(searchKeyword(query, topK * 2)), // 키워드 검색은 더 많이 가져옴
  ]);

  // 벡터 검색 수행
  const vectorResults = await vectorSearch(queryEmbedding, topK * 2, 0.2);

  // 결과가 모두 없으면 빈 배열 반환
  if (vectorResults.length === 0 && keywordResults.length === 0) {
    return [];
  }

  // 점수 병합을 위한 Map (key: text의 hash)
  const scoreMap = new Map<string, HybridSearchResult>();

  // 벡터 결과 처리 (코사인 유사도: 이미 0-1 범위)
  for (const result of vectorResults) {
    const key = makeKey(result.text, result.source);
    scoreMap.set(key, {
      text: result.text,
      source: result.source,
      score: result.score * vectorWeight,
      vectorScore: result.score,
    });
  }

  // 키워드 결과 정규화 및 병합
  if (keywordResults.length > 0) {
    const minBm25 = Math.min(...keywordResults.map(r => r.score));
    const maxBm25 = Math.max(...keywordResults.map(r => r.score));

    for (const result of keywordResults) {
      const key = makeKey(result.text, result.source);
      const normalizedScore = normalizeBm25Score(result.score, minBm25, maxBm25);

      const existing = scoreMap.get(key);
      if (existing) {
        // 이미 벡터 결과에 있으면 점수 합산
        existing.score += normalizedScore * keywordWeight;
        existing.keywordScore = normalizedScore;
      } else {
        // 새로운 결과
        scoreMap.set(key, {
          text: result.text,
          source: result.source,
          score: normalizedScore * keywordWeight,
          keywordScore: normalizedScore,
        });
      }
    }
  }

  // 점수 기준 정렬 후 상위 K개 반환
  const results = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results;
}

/**
 * 벡터 검색만 수행합니다. (기존 동작 호환)
 */
export async function searchVector(
  query: string,
  topK: number = 5,
  minScore: number = 0.3
): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);
  return vectorSearch(queryEmbedding, topK, minScore);
}

/**
 * 키워드 검색만 수행합니다.
 */
export function searchByKeyword(
  query: string,
  limit: number = 10
): FtsSearchResult[] {
  return searchKeyword(query, limit);
}

/**
 * 텍스트와 소스로 고유 키를 생성합니다.
 */
function makeKey(text: string, source: string): string {
  // 간단한 해시: 처음 100자 + 소스
  return `${source}:${text.slice(0, 100)}`;
}
