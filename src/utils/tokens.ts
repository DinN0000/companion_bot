/**
 * Token estimation utilities
 * 
 * Claude roughly uses:
 * - English: ~4 chars per token
 * - Korean: ~2-3 chars per token
 * 
 * These are rough estimates for context management, not exact counts.
 */

export interface MessageLike {
  content: string | unknown;
  role?: string;
}

/**
 * Estimate token count for a text string
 */
export function estimateTokens(text: string): number {
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const otherChars = text.length - koreanChars;
  return Math.ceil(koreanChars / 2 + otherChars / 4);
}

/**
 * Estimate token count for an array of messages
 */
export function estimateMessagesTokens(messages: MessageLike[]): number {
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    return sum + estimateTokens(content) + 4; // 메시지 오버헤드
  }, 0);
}
