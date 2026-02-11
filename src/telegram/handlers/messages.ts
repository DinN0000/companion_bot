import type { Bot, Context } from "grammy";
import { chat, chatSmart, type Message, type ModelId, type ThinkingLevel } from "../../ai/claude.js";
import { recordActivity, recordError } from "../../health/index.js";
import {
  getHistory,
  getModel,
  getThinkingLevel,
  runWithChatId,
  trimHistoryByTokens,
  smartTrimHistory,
  detectImportantContext,
  pinContext,
  addMessage,
} from "../../session/state.js";
import * as persistence from "../../session/persistence.js";
import { updateLastMessageTime } from "../../heartbeat/index.js";
import {
  extractUrls,
  fetchWebContent,
  formatUrlContent,
  buildSystemPrompt,
  formatMessageTimestamp,
} from "../utils/index.js";
import { estimateMessagesTokens } from "../../utils/tokens.js";
import { TOKENS, TELEGRAM } from "../../config/constants.js";
import { formatErrorForUser, toUserFriendlyError } from "../../utils/retry.js";

/**
 * Typing indicator를 주기적으로 갱신하는 클래스
 * 텔레그램은 5초 후 typing 상태가 자동 해제되므로, 긴 작업 중 유지 필요
 */
class TypingIndicator {
  private ctx: Context;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isActive = false;
  
  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  
  /** typing 표시 시작 (주기적 갱신) */
  start(): void {
    if (this.isActive) return;
    this.isActive = true;
    
    // 즉시 한 번 전송
    this.sendTyping();
    
    // 주기적으로 갱신 (4초마다 - 5초 만료 전)
    this.intervalId = setInterval(() => {
      if (this.isActive) {
        this.sendTyping();
      }
    }, TELEGRAM.TYPING_REFRESH_MS);
  }
  
  /** typing 표시 중지 */
  stop(): void {
    this.isActive = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  private async sendTyping(): Promise<void> {
    try {
      await this.ctx.replyWithChatAction("typing");
    } catch {
      // 실패해도 무시 (봇 차단 등)
    }
  }
}

/**
 * 토큰 사용량이 임계치를 넘으면 자동으로 히스토리 압축
 * 실패해도 메시지 처리에 영향 없도록 에러를 조용히 처리
 */
async function autoCompactIfNeeded(
  ctx: Context,
  history: Message[]
): Promise<void> {
  try {
    const tokens = estimateMessagesTokens(history);
    const usage = tokens / TOKENS.MAX_CONTEXT;

    if (usage > TOKENS.COMPACTION_THRESHOLD && history.length > 6) {
      // 자동 compaction 실행
      console.log(`[AutoCompact] chatId=${ctx.chat?.id} usage=${(usage * 100).toFixed(1)}% - compacting...`);

      // 앞부분 요약 생성 (최근 4개 메시지 제외)
      const oldMessages = history.slice(0, -4);
      const summaryPrompt =
        "다음 대화를 3-4문장으로 요약해줘:\n\n" +
        oldMessages
          .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
          .join("\n");

      const summaryResult = await chat([{ role: "user", content: summaryPrompt }], "", "haiku");

      // 히스토리 교체
      const recentMessages = history.slice(-4);
      history.splice(0, history.length);
      history.push({ role: "user", content: `[이전 대화 요약]\n${summaryResult.text}` });
      history.push(...recentMessages);

      const newTokens = estimateMessagesTokens(history);
      await ctx.reply(`📦 자동 정리: ${tokens} → ${newTokens} 토큰`);
    }
  } catch (error) {
    // 자동 압축 실패는 치명적이지 않음 - 로깅만 하고 계속 진행
    console.warn(`[AutoCompact] Failed for chatId=${ctx.chat?.id}:`, error instanceof Error ? error.message : error);
  }
}

/**
 * 긴 메시지를 텔레그램 제한에 맞게 분할
 */
function splitLongMessage(text: string, maxLength: number = TELEGRAM.MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];
  
  const parts: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }
    
    // 자연스러운 분할 지점 찾기 (문단 > 문장 > 단어 > 강제)
    let splitPoint = remaining.lastIndexOf("\n\n", maxLength);
    if (splitPoint < maxLength * 0.5) {
      splitPoint = remaining.lastIndexOf(". ", maxLength);
    }
    if (splitPoint < maxLength * 0.5) {
      splitPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitPoint < maxLength * 0.3) {
      splitPoint = maxLength;
    }
    
    parts.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint).trimStart();
  }
  
  return parts;
}

/**
 * 응답을 전송 (긴 응답은 분할)
 */
async function sendResponse(ctx: Context, text: string): Promise<void> {
  const parts = splitLongMessage(text);
  for (const part of parts) {
    await ctx.reply(part);
  }
}

/**
 * 메시지 핸들러들을 봇에 등록합니다.
 */
export function registerMessageHandlers(bot: Bot): void {
  // 사진 메시지 처리
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    
    await runWithChatId(chatId, async () => {
      recordActivity();
      const history = getHistory(chatId);
      const modelId = getModel(chatId);
      const thinkingLevel = getThinkingLevel(chatId);

      // Typing indicator 시작 (긴 작업 동안 유지)
      const typingIndicator = new TypingIndicator(ctx);
      typingIndicator.start();

      try {
        // 가장 큰 사진 선택 (마지막이 가장 큼)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.api.getFile(photo.file_id);

        if (!file.file_path) {
          typingIndicator.stop();
          await ctx.reply("사진을 가져올 수 없어.");
          return;
        }

        // 파일 크기 제한
        if (file.file_size && file.file_size > TELEGRAM.MAX_IMAGE_SIZE) {
          typingIndicator.stop();
          const maxMb = Math.floor(TELEGRAM.MAX_IMAGE_SIZE / (1024 * 1024));
          await ctx.reply(`사진이 너무 커. ${maxMb}MB 이하로 보내줄래?`);
          return;
        }

        // 파일 다운로드
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        // 캡션이 있으면 사용, 없으면 기본 질문 (타임스탬프 포함)
        const rawCaption = ctx.message.caption || "이 사진에 뭐가 있어?";
        const caption = `${formatMessageTimestamp()} ${rawCaption}`;

        // 이미지와 텍스트를 함께 전송
        const imageContent = [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/jpeg" as const,
              data: base64,
            },
          },
          {
            type: "text" as const,
            text: caption,
          },
        ];

        // API용 메모리 히스토리에는 이미지 데이터 포함
        history.push({ role: "user", content: imageContent });
        // JSONL에는 캡션만 저장 (이미지 base64는 너무 큼) - caption에 이미 타임스탬프 포함
        persistence.appendMessage(chatId, "user", `[이미지] ${caption}`);

        try {
          const systemPrompt = await buildSystemPrompt(modelId, history);
          const result = await chat(history, systemPrompt, modelId, thinkingLevel);

          // 도구 사용 정보를 포함한 응답 기록
          let assistantContent = result.text;
          if (result.toolsUsed.length > 0) {
            const toolsSummary = result.toolsUsed
              .map(t => `[${t.name}] ${t.output.slice(0, 100)}...`)
              .join("\n");
            assistantContent = `[도구 사용: ${result.toolsUsed.map(t => t.name).join(", ")}]\n${toolsSummary}\n\n---\n${result.text}`;
          }
          // 메모리 + JSONL 영구 저장
          history.push({ role: "assistant", content: assistantContent });
          persistence.appendMessage(chatId, "assistant", assistantContent);

          // 토큰 기반 히스토리 트리밍
          trimHistoryByTokens(history);

          typingIndicator.stop();
          
          // 빈 응답이면 메시지 안 보냄
          const responseText = result.text.trim();
          if (responseText) {
            await ctx.reply(responseText);
          }
        } catch (innerError) {
          typingIndicator.stop();
          
          // 에러 발생해도 사용자 메시지는 보존 (대화 컨텍스트 유지)
          // 에러 응답을 assistant로 기록해서 role 교대 유지
          const friendlyError = toUserFriendlyError(innerError);
          const userErrorMsg = `사진 분석 중 ${friendlyError.userMessage}${friendlyError.suggestedAction ? ` ${friendlyError.suggestedAction}` : ""}`;
          
          history.push({ role: "assistant", content: `[응답 실패] ${userErrorMsg}` });
          persistence.appendMessage(chatId, "assistant", `[응답 실패] ${userErrorMsg}`);
          
          recordError();
          console.error(`[Photo] chatId=${chatId} error:`, friendlyError.technicalMessage);
          await ctx.reply(userErrorMsg);
          return;
        }
      } catch (error) {
        typingIndicator.stop();
        
        // 이미지 다운로드 등 history.push() 전 에러는 그냥 응답만
        recordError();
        
        const friendlyError = toUserFriendlyError(error);
        console.error(`[Photo] chatId=${chatId} error:`, friendlyError.technicalMessage);
        
        const userErrorMsg = `사진 처리 중 ${friendlyError.userMessage}${friendlyError.suggestedAction ? ` ${friendlyError.suggestedAction}` : ""}`;
        await ctx.reply(userErrorMsg);
      }
    });
  });

  // 일반 메시지 처리
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // 빈 메시지 무시
    if (!userMessage.trim()) return;

    await runWithChatId(chatId, async () => {
      // Health 추적: 활동 기록
      recordActivity();
      
      // Heartbeat 마지막 대화 시간 업데이트
      updateLastMessageTime(chatId);

      const history = getHistory(chatId);
      const modelId = getModel(chatId);
      const thinkingLevel = getThinkingLevel(chatId);

      // 중요 맥락 자동 감지 및 핀
      const importantContext = detectImportantContext(userMessage);
      if (importantContext) {
        pinContext(chatId, importantContext, "auto");
        console.log(`[AutoPin] chatId=${chatId}: ${importantContext.slice(0, 50)}...`);
      }

      await ctx.replyWithChatAction("typing");

      // URL 감지 및 내용 가져오기 (병렬 처리)
      const urls = extractUrls(userMessage);
      let messageForHistory = userMessage;
      let urlContextForApi = ""; // 현재 요청에만 주입될 URL 내용

      if (urls.length > 0) {
        const urlsToFetch = urls.slice(0, TELEGRAM.MAX_URL_FETCH);
        const contents = await Promise.all(
          urlsToFetch.map((url) => fetchWebContent(url))
        );

        const urlRefs: string[] = [];
        
        for (let i = 0; i < contents.length; i++) {
          const content = contents[i];
          if (!content) continue;
          
          const formatted = formatUrlContent(urlsToFetch[i], content);
          urlRefs.push(formatted.forHistory);
          urlContextForApi += formatted.forContext;
        }

        // 히스토리에는 간략한 링크 참조만 저장
        if (urlRefs.length > 0) {
          messageForHistory = userMessage + "\n\n" + urlRefs.join("\n");
        }
      }

      // 히스토리에는 간략 버전 저장 + JSONL에 영구 저장 (타임스탬프 포함)
      const timestampedMessage = formatMessageTimestamp() + " " + messageForHistory;
      addMessage(chatId, "user", timestampedMessage);

      // Typing indicator 시작 (긴 작업 동안 유지)
      const typingIndicator = new TypingIndicator(ctx);
      typingIndicator.start();

      try {
        const systemPrompt = await buildSystemPrompt(modelId, history);
        
        // API 호출용 메시지 준비 (URL 전체 내용 포함)
        const messagesForApi = [...history];
        if (urlContextForApi) {
          // 마지막 user 메시지에 URL 내용 추가 (API 호출 시에만)
          const lastIdx = messagesForApi.length - 1;
          const lastMsg = messagesForApi[lastIdx];
          if (typeof lastMsg.content === "string") {
            messagesForApi[lastIdx] = {
              ...lastMsg,
              content: lastMsg.content + urlContextForApi
            };
          }
        }
        
        // AI 응답 생성 (typing indicator 동안)
        const result = await chatSmart(
          messagesForApi,
          systemPrompt,
          modelId,
          thinkingLevel
        );

        typingIndicator.stop();
        
        // 빈 응답이면 메시지 안 보냄 (도구만 실행한 경우)
        const responseText = result.text.trim();
        if (responseText) {
          await sendResponse(ctx, responseText);
          addMessage(chatId, "assistant", responseText);
        }

        // 스마트 트리밍 (요약 포함) - autoCompactIfNeeded 대체
        const summarizeFn = async (messages: Message[]) => {
          const summaryPrompt =
            "다음 대화를 핵심만 3-4문장으로 요약해. 중요한 정보(이름, 선호도, 약속 등)는 반드시 포함:\n\n" +
            messages
              .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
              .join("\n");
          const result = await chat([{ role: "user", content: summaryPrompt }], "", "haiku");
          return result.text;
        };
        
        const wasSummarized = await smartTrimHistory(chatId, summarizeFn);
        if (!wasSummarized) {
          // 요약 안 됐으면 기본 트리밍
          trimHistoryByTokens(history);
        }
      } catch (error) {
        typingIndicator.stop();
        recordError();
        
        // 에러를 사용자 친화적 메시지로 변환
        const friendlyError = toUserFriendlyError(error);
        console.error(`[Chat] chatId=${chatId} error:`, friendlyError.technicalMessage);
        
        // 사용자 메시지 구성
        const userErrorMsg = friendlyError.suggestedAction
          ? `${friendlyError.userMessage} ${friendlyError.suggestedAction}`
          : friendlyError.userMessage;
        
        // 에러 메시지를 assistant 응답으로 기록 (히스토리 컨텍스트 유지) + JSONL 저장
        // 재시도 가능한 에러는 "[일시적 오류]"로, 아니면 "[응답 실패]"로 표시
        const prefix = friendlyError.isRetryable ? "[일시적 오류]" : "[응답 실패]";
        addMessage(chatId, "assistant", `${prefix} ${userErrorMsg}`);
        
        await ctx.reply(userErrorMsg);
      }
    });
  });
}
