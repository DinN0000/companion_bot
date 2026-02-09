import type { Bot, Context } from "grammy";
import { chat, chatSmart, type Message, type ModelId } from "../../ai/claude.js";
import { recordActivity, recordError } from "../../health/index.js";
import {
  getHistory,
  getModel,
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
} from "../utils/index.js";
import { estimateMessagesTokens } from "../../utils/tokens.js";

const MAX_CONTEXT_TOKENS = 100000; // Claude 컨텍스트
const COMPACTION_THRESHOLD = 0.35; // 35% (35,000 토큰) - MAX_HISTORY_TOKENS(50k)보다 먼저 트리거되도록

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
    const usage = tokens / MAX_CONTEXT_TOKENS;

    if (usage > COMPACTION_THRESHOLD && history.length > 6) {
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
 * 스트리밍 응답 전송 (Telegram 메시지 실시간 업데이트)
 */
async function sendStreamingResponse(
  ctx: Context,
  messages: Message[],
  systemPrompt: string,
  modelId: ModelId
): Promise<string> {
  // 1. 먼저 "..." 플레이스홀더 메시지 전송
  const placeholder = await ctx.reply("...");
  const chatId = ctx.chat!.id;
  const messageId = placeholder.message_id;

  let lastUpdate = Date.now();
  const UPDATE_INTERVAL = 500; // 0.5초마다 업데이트 (Telegram rate limit 고려)
  let lastText = "";

  try {
    const result = await chatSmart(
      messages,
      systemPrompt,
      modelId,
      async (_chunk: string, accumulated: string) => {
        const now = Date.now();
        // 0.5초마다 또는 충분히 변경되었을 때 업데이트
        if (now - lastUpdate > UPDATE_INTERVAL && accumulated !== lastText) {
          try {
            await ctx.api.editMessageText(chatId, messageId, accumulated + " ▌");
            lastUpdate = now;
            lastText = accumulated;
          } catch {
            // rate limit 등 무시
          }
        }
      }
    );

    // 도구를 사용한 경우 스트리밍이 안됐으므로 새 응답 전송
    if (result.usedTools) {
      // placeholder 메시지를 최종 결과로 교체
      try {
        await ctx.api.editMessageText(chatId, messageId, result.text);
      } catch {
        // 실패시 새 메시지로 전송
        await ctx.api.deleteMessage(chatId, messageId);
        await ctx.reply(result.text);
      }
      return result.text;
    }

    // 최종 메시지 업데이트 (커서 제거)
    try {
      await ctx.api.editMessageText(chatId, messageId, result.text);
    } catch {
      // 이미 동일 텍스트면 에러 발생 가능 - 무시
    }

    return result.text;
  } catch (error) {
    // 에러 발생 시 placeholder 삭제
    try {
      await ctx.api.deleteMessage(chatId, messageId);
    } catch {
      // 삭제 실패해도 계속 진행
    }
    throw error; // 에러 재전파
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

      await ctx.replyWithChatAction("typing");

      try {
        // 가장 큰 사진 선택 (마지막이 가장 큼)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.api.getFile(photo.file_id);

        if (!file.file_path) {
          await ctx.reply("사진을 가져올 수 없어.");
          return;
        }

        // 파일 크기 제한 (10MB)
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (file.file_size && file.file_size > MAX_IMAGE_SIZE) {
          await ctx.reply("사진이 너무 커. 10MB 이하로 보내줄래?");
          return;
        }

        // 파일 다운로드
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        // 캡션이 있으면 사용, 없으면 기본 질문
        const caption = ctx.message.caption || "이 사진에 뭐가 있어?";

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
        // JSONL에는 캡션만 저장 (이미지 base64는 너무 큼)
        persistence.appendMessage(chatId, "user", `[이미지] ${caption}`);

        try {
          const systemPrompt = await buildSystemPrompt(modelId, history);
          const result = await chat(history, systemPrompt, modelId);

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

          await ctx.reply(result.text);
        } catch (innerError) {
          // 에러 발생해도 사용자 메시지는 보존 (대화 컨텍스트 유지)
          // 에러 응답을 assistant로 기록해서 role 교대 유지
          const errorMsg = innerError instanceof Error ? innerError.message : String(innerError);
          
          let userErrorMsg: string;
          if (errorMsg.includes("rate limit") || errorMsg.includes("429")) {
            userErrorMsg = "지금 요청이 많아서 사진을 분석할 수 없어. 잠시 후 다시 보내줄래?";
          } else if (errorMsg.includes("timeout")) {
            userErrorMsg = "사진 분석이 너무 오래 걸렸어. 다시 보내줄래?";
          } else {
            userErrorMsg = "사진을 분석하다가 문제가 생겼어. 다시 보내줄래?";
          }
          
          history.push({ role: "assistant", content: `[응답 실패] ${userErrorMsg}` });
          persistence.appendMessage(chatId, "assistant", `[응답 실패] ${userErrorMsg}`);
          
          recordError();
          console.error(`[Photo] chatId=${chatId} error:`, errorMsg);
          await ctx.reply(userErrorMsg);
          return;
        }
      } catch (error) {
        // 이미지 다운로드 등 history.push() 전 에러는 그냥 응답만
        recordError();
        
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Photo] chatId=${chatId} error:`, errorMsg);
        
        if (errorMsg.includes("rate limit") || errorMsg.includes("429")) {
          await ctx.reply("지금 요청이 많아서 사진을 분석할 수 없어. 잠시 후 다시 보내줄래?");
        } else if (errorMsg.includes("timeout")) {
          await ctx.reply("사진 분석이 너무 오래 걸렸어. 다시 보내줄래?");
        } else {
          await ctx.reply("사진을 분석하다가 문제가 생겼어. 다시 보내줄래?");
        }
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
        const urlsToFetch = urls.slice(0, 3); // 최대 3개 URL
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

      // 히스토리에는 간략 버전 저장 + JSONL에 영구 저장
      addMessage(chatId, "user", messageForHistory);

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
        
        // 스트리밍 응답 사용 (실시간 업데이트)
        const response = await sendStreamingResponse(
          ctx,
          messagesForApi, // URL 내용이 포함된 버전
          systemPrompt,
          modelId
        );

        // 메모리 + JSONL에 영구 저장
        addMessage(chatId, "assistant", response);

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
        recordError();
        
        // 구체적인 에러 로깅
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Chat] chatId=${chatId} error:`, errorMsg);
        
        // 에러 응답을 assistant로 기록 (사용자 메시지 보존 + role 교대 유지)
        // 이렇게 하면 에러 발생해도 대화 컨텍스트 유지됨
        let userErrorMsg: string;
        if (errorMsg.includes("rate limit") || errorMsg.includes("429")) {
          userErrorMsg = "지금 요청이 많아서 잠깐 쉬어야 해. 30초 후에 다시 시도해줄래?";
        } else if (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT")) {
          userErrorMsg = "응답이 너무 오래 걸려서 중단됐어. 다시 시도해줄래?";
        } else if (errorMsg.includes("context_length") || errorMsg.includes("too many tokens") || errorMsg.includes("maximum context")) {
          userErrorMsg = "대화가 너무 길어졌어. /compact 로 정리하고 다시 시도해줘!";
        } else {
          userErrorMsg = `문제가 생겼어: ${errorMsg.slice(0, 100)}`;
        }
        
        // 에러 메시지를 assistant 응답으로 기록 (히스토리 컨텍스트 유지) + JSONL 저장
        addMessage(chatId, "assistant", `[응답 실패] ${userErrorMsg}`);
        
        await ctx.reply(userErrorMsg);
      }
    });
  });
}
