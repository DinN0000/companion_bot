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
import { getSecret, setSecret } from "../config/secrets.js";
import { setBotInstance, restoreReminders, getReminders } from "../reminders/index.js";
import {
  isCalendarConfigured,
  hasCredentials,
  setCredentials,
  getAuthUrl,
  startAuthServer,
  exchangeCodeForToken,
  getTodayEvents,
  formatEvent,
} from "../calendar/index.js";

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

  // 리마인더 시스템 초기화
  setBotInstance(bot);
  restoreReminders().catch((err) => console.error("Failed to restore reminders:", err));

  // 에러 핸들링
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  // 명령어 목록 등록
  bot.api.setMyCommands([
    { command: "compact", description: "대화 정리하기" },
    { command: "memory", description: "최근 기억 보기" },
    { command: "reminders", description: "알림 목록 보기" },
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

  // /setup 명령어 - 추가 기능 설정 목록
  bot.command("setup", async (ctx) => {
    const weatherKey = await getSecret("openweathermap-api-key");
    const calendarConfigured = await isCalendarConfigured();

    const features = [
      {
        name: "날씨",
        command: "/weather_setup",
        configured: !!weatherKey,
      },
      {
        name: "Google Calendar",
        command: "/calendar_setup",
        configured: calendarConfigured,
      },
    ];

    let message = "⚙️ 추가 기능 설정\n\n";

    features.forEach((feature, index) => {
      const status = feature.configured ? "✓ 설정됨" : "✗ 미설정";
      message += `${index + 1}. ${feature.name} (${feature.command})\n`;
      message += `   상태: ${status}\n\n`;
    });

    message += "설정하려면 각 명령어를 입력하세요.";

    await ctx.reply(message);
  });

  // /weather_setup 명령어 - 날씨 API 키 설정
  bot.command("weather_setup", async (ctx) => {
    const arg = ctx.message?.text?.split(" ").slice(1).join(" ");

    if (!arg) {
      const hasKey = await getSecret("openweathermap-api-key");
      await ctx.reply(
        `날씨 API 설정\n\n` +
        `상태: ${hasKey ? "✓ 설정됨" : "✗ 미설정"}\n\n` +
        `설정 방법:\n` +
        `1. https://openweathermap.org 가입\n` +
        `2. API Keys에서 키 발급\n` +
        `3. /weather_setup YOUR_API_KEY 입력`
      );
      return;
    }

    await setSecret("openweathermap-api-key", arg);
    await ctx.reply("✓ 날씨 API 키가 설정되었습니다!");
  });

  // /reminders 명령어 - 알림 목록
  bot.command("reminders", async (ctx) => {
    const chatId = ctx.chat.id;
    const reminders = await getReminders(chatId);

    if (reminders.length === 0) {
      await ctx.reply("📭 설정된 알림이 없어요.\n\n\"10분 뒤에 알려줘\" 같이 말해보세요!");
      return;
    }

    let message = "⏰ 알림 목록\n\n";

    for (const r of reminders) {
      const time = new Date(r.scheduledAt).toLocaleString("ko-KR", {
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      });
      message += `• ${r.message}\n  📅 ${time}\n  🔖 ID: ${r.id}\n\n`;
    }

    message += "취소하려면 \"리마인더 취소해줘\" 라고 말해주세요.";

    await ctx.reply(message);
  });

  // /calendar_setup 명령어 - Google Calendar 연동
  bot.command("calendar_setup", async (ctx) => {
    const args = ctx.message?.text?.split(" ").slice(1) || [];

    // 현재 상태 확인
    if (args.length === 0) {
      const configured = await isCalendarConfigured();
      const hasCreds = await hasCredentials();

      if (configured) {
        // 오늘 일정 미리보기
        try {
          const events = await getTodayEvents();
          const preview = events.length > 0
            ? events.slice(0, 3).map(formatEvent).join("\n")
            : "오늘 일정 없음";

          await ctx.reply(
            `📅 Google Calendar 연동됨!\n\n` +
            `오늘 일정:\n${preview}\n\n` +
            `"오늘 일정 뭐야?" 라고 물어보세요.`
          );
        } catch {
          await ctx.reply(`📅 Google Calendar 연동됨!\n\n"오늘 일정 뭐야?" 라고 물어보세요.`);
        }
        return;
      }

      if (hasCreds) {
        // credentials 있지만 인증 안됨
        const authUrl = await getAuthUrl();
        if (authUrl) {
          await ctx.reply(
            `📅 Google Calendar 인증 필요\n\n` +
            `아래 링크에서 인증해주세요:\n${authUrl}\n\n` +
            `인증 후 자동으로 연결됩니다.`
          );

          // 백그라운드에서 인증 서버 시작
          startAuthServer()
            .then(async (code) => {
              const success = await exchangeCodeForToken(code);
              if (success) {
                await ctx.reply("✅ Google Calendar 연동 완료!");
              } else {
                await ctx.reply("❌ 인증 실패. 다시 시도해주세요.");
              }
            })
            .catch(() => {
              // 타임아웃 등
            });
        }
        return;
      }

      // 설정 안내
      await ctx.reply(
        `📅 Google Calendar 설정\n\n` +
        `1. Google Cloud Console 접속\n` +
        `   console.cloud.google.com\n\n` +
        `2. 프로젝트 생성 → Calendar API 활성화\n\n` +
        `3. OAuth 동의 화면 설정\n` +
        `   - 앱 이름: CompanionBot\n` +
        `   - 범위: calendar.readonly, calendar.events\n\n` +
        `4. 사용자 인증 정보 → OAuth 클라이언트 ID\n` +
        `   - 유형: 데스크톱 앱\n` +
        `   - 리디렉션 URI: http://localhost:3847/oauth2callback\n\n` +
        `5. 클라이언트 ID와 Secret 복사 후:\n` +
        `/calendar_setup CLIENT_ID CLIENT_SECRET`
      );
      return;
    }

    // credentials 설정
    if (args.length === 2) {
      const [clientId, clientSecret] = args;
      await setCredentials(clientId, clientSecret);

      const authUrl = await getAuthUrl();
      if (authUrl) {
        await ctx.reply(
          `✅ Credentials 저장됨!\n\n` +
          `아래 링크에서 인증해주세요:\n${authUrl}\n\n` +
          `인증 완료 후 자동으로 연결됩니다.`
        );

        // 인증 서버 시작
        startAuthServer()
          .then(async (code) => {
            const success = await exchangeCodeForToken(code);
            if (success) {
              await ctx.reply("✅ Google Calendar 연동 완료!");
            } else {
              await ctx.reply("❌ 인증 실패. 다시 시도해주세요.");
            }
          })
          .catch(() => {
            // 타임아웃
          });
      }
      return;
    }

    await ctx.reply("사용법: /calendar_setup CLIENT_ID CLIENT_SECRET");
  });

  // /calendar 명령어 - 오늘 일정 보기
  bot.command("calendar", async (ctx) => {
    const configured = await isCalendarConfigured();

    if (!configured) {
      await ctx.reply("📅 캘린더가 연동되지 않았어요.\n/calendar_setup 으로 설정해주세요.");
      return;
    }

    try {
      const events = await getTodayEvents();

      if (events.length === 0) {
        await ctx.reply("📅 오늘 일정이 없어요!");
        return;
      }

      let message = "📅 오늘 일정\n\n";
      for (const event of events) {
        message += `• ${formatEvent(event)}\n`;
      }

      await ctx.reply(message);
    } catch (error) {
      console.error("Calendar error:", error);
      await ctx.reply("캘린더 조회 중 오류가 발생했어요.");
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
