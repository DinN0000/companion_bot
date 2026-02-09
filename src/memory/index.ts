// Memory module exports

// Embeddings
export { embed, embedBatch, cosineSimilarity } from "./embeddings.js";

// Vector store
export { search, invalidateCache, loadAllMemoryChunks } from "./vectorStore.js";
export type { MemoryChunk, SearchResult } from "./vectorStore.js";

// FTS index
export { 
  indexText, 
  indexTextBatch, 
  searchKeyword, 
  deleteBySource as deleteFtsBySource,
  deleteById as deleteFtsById,
  clearIndex as clearFtsIndex,
  getDocumentCount,
  closeDb as closeFtsDb,
} from "./ftsIndex.js";
export type { FtsEntry, FtsSearchResult } from "./ftsIndex.js";

// Hybrid search
export { 
  hybridSearch, 
  searchVector, 
  searchByKeyword,
} from "./hybridSearch.js";
export type { HybridSearchResult } from "./hybridSearch.js";

// Indexer
export { 
  indexFile, 
  indexMainMemory, 
  indexDailyMemories, 
  indexConversation,
  reindexAll,
} from "./indexer.js";
