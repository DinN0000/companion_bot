import { Bot } from "grammy";
import * as cheerio from "cheerio";
import { chat, MODELS, type Message, type ModelId } from "../ai/claude.js";
import {
  getHistory,
  clearHistory,
  getModel,
  setModel,
  setCurrentChatId,
} from "../session/state.js";
import {
  loadWorkspace,
  hasBootstrap,
  deleteBootstrap,
  loadRecentMemories,
  getWorkspacePath,
  type Workspace,
} from "../workspace/index.js";
import { getToolsDescription } from "../tools/index.js";

// 워크스페이스 캐시
let cachedWorkspace: Workspace | null = null;
let workspaceCacheTime = 0;
const CACHE_TTL = 60000; // 1분

async function getWorkspace(): Promise<Workspace> {
  const now = Date.now();
  if (!cachedWorkspace || now - workspaceCacheTime > CACHE_TTL) {
    cachedWorkspace = await loadWorkspace();
    workspaceCacheTime = now;
  }
  return cachedWorkspace;
}

// 워크스페이스 캐시 무효화
export function invalidateWorkspaceCache(): void {
  cachedWorkspace = null;
}

function extractName(identityContent: string | null): string | null {
  if (!identityContent) return null;
  const match = identityContent.match(/##\s*이름\s*\n+([^\n(]+)/);
  if (match && match[1]) {
    const name = match[1].trim();
    if (name && !name.includes("정해지지") && !name.includes("아직")) {
      return name;
    }
  }
  return null;
}

// URL 추출
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  return text.match(urlRegex) || [];
}

// 웹페이지 내용 가져오기
async function fetchWebContent(url: string): Promise<{ title: string; content: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CompanionBot/1.0)",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $("script, style, nav, footer, header, aside, .ad, .advertisement").remove();

    // 제목 추출
    const title = $("title").text().trim() ||
      $("h1").first().text().trim() ||
      "제목 없음";

    // 본문 추출 (article, main, body 순으로 시도)
    let content = "";
    const mainContent = $("article").text() ||
      $("main").text() ||
      $(".content").text() ||
      $("body").text();

    // 텍스트 정리
    content = mainContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000); // 5000자로 제한

    return { title, content };
  } catch (error) {
    console.error("Fetch error:", error);
    return null;
  }
}

async function buildSystemPrompt(modelId: ModelId): Promise<string> {
  const model = MODELS[modelId];
  const workspace = await getWorkspace();
  const parts: string[] = [];

  // 기본 정보
  parts.push(`You are a personal AI companion running on ${model.name}.`);
  parts.push(`Workspace: ${getWorkspacePath()}`);

  // BOOTSTRAP 모드인 경우
  if (workspace.bootstrap) {
    parts.push("---");
    parts.push("# 온보딩 모드 활성화");
    parts.push(workspace.bootstrap);
    parts.push("---");
    parts.push(`온보딩 완료 후 save_persona 도구를 사용하여 설정을 저장하세요.`);
  } else {
    // 일반 모드: 워크스페이스 파일들 로드
    if (workspace.identity) {
      parts.push("---");
      parts.push(workspace.identity);
    }

    if (workspace.soul) {
      parts.push("---");
      parts.push(workspace.soul);
    }

    if (workspace.user) {
      parts.push("---");
      parts.push(workspace.user);
    }

    if (workspace.agents) {
      parts.push("---");
      parts.push(workspace.agents);
    }

    // 최근 기억 로드
    const recentMemories = await loadRecentMemories(3);
    if (recentMemories.trim()) {
      parts.push("---");
      parts.push("# 최근 기억");
      parts.push(recentMemories);
    }

    if (workspace.memory) {
      parts.push("---");
      parts.push("# 장기 기억");
      parts.push(workspace.memory);
    }
  }

  // 도구 설명
  parts.push("---");
  parts.push(getToolsDescription(modelId));

  return parts.join("\n\n");
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // 에러 핸들링
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  // 명령어 목록 등록
  bot.api.setMyCommands([
    { command: "compact", description: "대화 정리하기" },
    { command: "memory", description: "최근 기억 보기" },
  ]).catch((err) => console.error("Failed to set commands:", err));

  // /start 명령어
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    clearHistory(chatId);
    setModel(chatId, "sonnet");
    setCurrentChatId(chatId);

    // 워크스페이스 캐시 무효화
    invalidateWorkspaceCache();

    // BOOTSTRAP 모드 확인
    const isBootstrap = await hasBootstrap();

    if (isBootstrap) {
      // 온보딩 모드: 봇이 먼저 인사
      await ctx.replyWithChatAction("typing");

      const history = getHistory(chatId);
      const modelId = getModel(chatId);
      const systemPrompt = await buildSystemPrompt(modelId);

      // 첫 메시지 생성 요청
      history.push({
        role: "user",
        content: "[시스템: 사용자가 /start를 눌렀습니다. 온보딩을 시작하세요.]",
      });

      try {
        const response = await chat(history, systemPrompt, modelId);
        history.push({ role: "assistant", content: response });
        await ctx.reply(response);
      } catch (error) {
        console.error("Bootstrap start error:", error);
        await ctx.reply(
          "안녕! 반가워. 난 방금 태어난 AI야. 아직 이름도 없어.\n" +
          "너와 함께 나를 만들어가고 싶은데... 혹시 이름 지어줄 수 있어?"
        );
      }
    } else {
      // 일반 모드
      const workspace = await getWorkspace();
      const name = extractName(workspace.identity) || "CompanionBot";

      await ctx.reply(
        `안녕! ${name}이야.\n\n` +
        `명령어:\n` +
        `/clear - 대화 초기화\n` +
        `/model - AI 모델 변경\n` +
        `/reset - 페르소나 리셋`
      );
    }
  });

  // /reset 명령어 - 페르소나 리셋
  bot.command("reset", async (ctx) => {
    await ctx.reply(
      "정말 페르소나를 리셋할까요?\n" +
      "모든 설정이 초기화되고 온보딩을 다시 진행합니다.\n\n" +
      "확인하려면 /confirm_reset 을 입력하세요."
    );
  });

  bot.command("confirm_reset", async (ctx) => {
    const { initWorkspace } = await import("../workspace/index.js");
    const { rm } = await import("fs/promises");
    const { getWorkspacePath } = await import("../workspace/index.js");

    try {
      await rm(getWorkspacePath(), { recursive: true, force: true });
      await initWorkspace();
      invalidateWorkspaceCache();
      clearHistory(ctx.chat.id);

      await ctx.reply(
        "✓ 페르소나가 리셋되었습니다.\n" +
        "/start 를 눌러 온보딩을 시작하세요."
      );
    } catch (error) {
      console.error("Reset error:", error);
      await ctx.reply("리셋 중 오류가 발생했습니다.");
    }
  });

  // /compact 명령어 - 대화 압축 (컨텍스트 절약)
  bot.command("compact", async (ctx) => {
    const chatId = ctx.chat.id;
    const history = getHistory(chatId);

    if (history.length <= 4) {
      await ctx.reply("아직 정리할 대화가 별로 없어!");
      return;
    }

    // 최근 4개만 남기고 정리
    const removed = history.length - 4;
    history.splice(0, removed);

    await ctx.reply(`대화 정리 완료! ${removed}개 메시지 압축했어.`);
  });

  // /memory 명령어 - 최근 기억 보기
  bot.command("memory", async (ctx) => {
    const memories = await loadRecentMemories(7);

    if (!memories.trim()) {
      await ctx.reply("아직 기억해둔 게 없어!");
      return;
    }

    // 너무 길면 자르기
    const truncated = memories.length > 2000
      ? memories.slice(0, 2000) + "\n\n... (더 있음)"
      : memories;

    await ctx.reply(`📝 최근 일주일 기억:\n\n${truncated}`);
  });

  // /model 명령어 - 모델 변경
  bot.command("model", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = ctx.message?.text?.split(" ")[1]?.toLowerCase();

    if (!arg) {
      const currentModel = getModel(chatId);
      const modelList = Object.entries(MODELS)
        .map(([id, m]) => `${id === currentModel ? "→" : "  "} /model ${id} - ${m.name}`)
        .join("\n");

      await ctx.reply(
        `Current model: ${MODELS[currentModel].name}\n\n` +
        `Available models:\n${modelList}\n\n` +
        `Tip: You can also ask me to change models in natural language!`
      );
      return;
    }

    if (arg in MODELS) {
      const modelId = arg as ModelId;
      setModel(chatId, modelId);
      await ctx.reply(`Model changed to: ${MODELS[modelId].name}`);
    } else {
      await ctx.reply(
        `Unknown model: ${arg}\n\n` +
        `Available: sonnet, opus, haiku`
      );
    }
  });

  // 사진 메시지 처리
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    setCurrentChatId(chatId);

    const history = getHistory(chatId);
    const modelId = getModel(chatId);

    // 타이핑 표시
    await ctx.replyWithChatAction("typing");

    try {
      // 가장 큰 사진 선택 (마지막이 가장 큼)
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);

      if (!file.file_path) {
        await ctx.reply("사진을 가져올 수 없어.");
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

      history.push({ role: "user", content: imageContent });

      const systemPrompt = await buildSystemPrompt(modelId);
      const result = await chat(history, systemPrompt, modelId);

      history.push({ role: "assistant", content: result });

      // 히스토리 제한
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      await ctx.reply(result);
    } catch (error) {
      console.error("Photo error:", error);
      await ctx.reply("사진 분석 중 오류가 발생했어.");
    }
  });

  // 일반 메시지 처리
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // 현재 chatId 설정 (도구에서 사용)
    setCurrentChatId(chatId);

    // 세션 가져오기
    const history = getHistory(chatId);
    const modelId = getModel(chatId);

    // 타이핑 표시
    await ctx.replyWithChatAction("typing");

    // URL 감지 및 내용 가져오기
    const urls = extractUrls(userMessage);
    let enrichedMessage = userMessage;

    if (urls.length > 0) {
      const webContents: string[] = [];

      for (const url of urls.slice(0, 3)) { // 최대 3개 URL
        const content = await fetchWebContent(url);
        if (content) {
          webContents.push(
            `\n\n---\n📎 Link: ${url}\n📌 Title: ${content.title}\n📄 Content:\n${content.content}\n---`
          );
        }
      }

      if (webContents.length > 0) {
        enrichedMessage = userMessage + webContents.join("\n");
      }
    }

    // 사용자 메시지 추가 (URL 내용 포함)
    history.push({ role: "user", content: enrichedMessage });

    try {
      // 동적 시스템 프롬프트 생성
      const systemPrompt = await buildSystemPrompt(modelId);

      // Claude에게 요청
      const response = await chat(history, systemPrompt, modelId);

      // 응답 추가
      history.push({ role: "assistant", content: response });

      // 히스토리 제한 (최근 20개 메시지만 유지)
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      // 응답 전송
      await ctx.reply(response);
    } catch (error) {
      console.error("Chat error:", error);
      await ctx.reply("뭔가 잘못됐어. 다시 시도해줄래?");
    }
  });

  return bot;
}
