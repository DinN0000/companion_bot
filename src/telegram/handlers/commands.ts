import { Bot } from "grammy";
import { randomBytes } from "crypto";
import { getHealthStatus, formatUptime } from "../../health/index.js";
import { chat, MODELS, type ModelId, type Message } from "../../ai/claude.js";
import { estimateMessagesTokens } from "../../utils/tokens.js";
import { TOKENS, MESSAGES, MEMORY, SECURITY, TELEGRAM } from "../../config/constants.js";

// 대화 요약 생성 함수
async function generateSummary(messages: Message[]): Promise<string> {
  const conversationText = messages.map(m => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return `${m.role === "user" ? "사용자" : "AI"}: ${content}`;
  }).join("\n");
  
  const summaryPrompt = [
    {
      role: "user" as const,
      content: `다음 대화를 핵심만 담아 간결하게 요약해줘. 중요한 결정사항, 사용자 정보, 맥락만 포함하고 3-5문장 이내로:

${conversationText}

요약:`
    }
  ];
  
  try {
    // haiku로 빠르게 요약 생성
    const result = await chat(summaryPrompt, undefined, "haiku");
    return result.text;
  } catch (error) {
    console.error("Summary generation error:", error);
    return "이전 대화 내용 (요약 생성 실패)";
  }
}

// Reset 토큰 관리 (1분 만료)
const resetTokens = new Map<number, { token: string; expiresAt: number }>();

function generateResetToken(chatId: number): string {
  const token = randomBytes(8).toString("hex");
  const expiresAt = Date.now() + SECURITY.RESET_TOKEN_TTL_MS;
  resetTokens.set(chatId, { token, expiresAt });
  return token;
}

function validateResetToken(chatId: number, token: string): boolean {
  const stored = resetTokens.get(chatId);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    resetTokens.delete(chatId);
    return false;
  }
  if (stored.token !== token) return false;
  resetTokens.delete(chatId); // 사용 후 삭제
  return true;
}
import {
  getHistory,
  clearHistory,
  getModel,
  setModel,
  runWithChatId,
  getPinnedContexts,
  pinContext,
  unpinContext,
  clearPins,
  getSessionStats,
  addMessage,
} from "../../session/state.js";
import {
  hasBootstrap,
  loadRecentMemories,
  getWorkspacePath,
} from "../../workspace/index.js";
import { getSecret, setSecret, deleteSecret } from "../../config/secrets.js";
import { getReminders } from "../../reminders/index.js";
import {
  isCalendarConfigured,
  hasCredentials,
  setCredentials,
  getAuthUrl,
  startAuthServer,
  exchangeCodeForToken,
  getTodayEvents,
  formatEvent,
  resetCalendar,
} from "../../calendar/index.js";
import {
  setBriefingConfig,
  getBriefingConfig,
  disableBriefing,
} from "../../briefing/index.js";
import {
  setHeartbeatConfig,
  getHeartbeatConfig,
  disableHeartbeat,
} from "../../heartbeat/index.js";
import {
  getWorkspace,
  invalidateWorkspaceCache,
  buildSystemPrompt,
  extractName,
} from "../utils/index.js";
import { ensureDefaultCronJobs } from "../../cron/scheduler.js";

export function registerCommands(bot: Bot): void {
  // /help 명령어 - 전체 기능 안내
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📖 도움말\n\n` +
      `🎯 기본 기능\n` +
      `/model - AI 모델 변경 (sonnet/opus/haiku)\n` +
      `/compact - 대화 압축해서 토큰 절약\n` +
      `/clear - 대화 초기화\n\n` +
      `📌 기억/핀\n` +
      `/memory - 최근 기억 보기\n` +
      `/pin [내용] - 중요한 정보 핀하기\n` +
      `/pins - 핀 목록 보기\n` +
      `/context - 현재 맥락 상태\n\n` +
      `⏰ 알림/일정\n` +
      `/reminders - 알림 목록\n` +
      `/briefing - 일일 브리핑 켜기/상태\n` +
      `/calendar - 오늘 일정 보기\n\n` +
      `⚙️ 설정\n` +
      `/setup - 기능별 설정 관리\n` +
      `/health - 봇 상태 확인\n` +
      `/reset - 페르소나 초기화\n\n` +
      `💡 자연어로도 말할 수 있어요:\n` +
      `• "opus로 바꿔줘"\n` +
      `• "10분 뒤에 알려줘"\n` +
      `• "기억해: 나는 채식주의자야"\n` +
      `• "내일 일정 뭐야?"`
    );
  });

  // /start 명령어
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    clearHistory(chatId);
    setModel(chatId, "sonnet");

    // 워크스페이스 캐시 무효화
    invalidateWorkspaceCache();

    // BOOTSTRAP 모드 확인
    const isBootstrap = await hasBootstrap();

    if (isBootstrap) {
      // 온보딩 모드: 봇이 먼저 인사 (runWithChatId로 감싸서 도구가 chatId 접근 가능)
      await runWithChatId(chatId, async () => {
        await ctx.replyWithChatAction("typing");

        const history = getHistory(chatId);
        const modelId = getModel(chatId);
        const systemPrompt = await buildSystemPrompt(modelId);

        // 첫 메시지 생성 요청 (시스템 메시지는 JSONL에 저장 안 함 - 세션 내부용)
        history.push({
          role: "user",
          content: "[시스템: 사용자가 /start를 눌렀습니다. 온보딩을 시작하세요.]",
        });

        try {
          const result = await chat(history, systemPrompt, modelId);
          // 온보딩 응답도 JSONL에 저장
          addMessage(chatId, "assistant", result.text);
          await ctx.reply(result.text);
        } catch (error) {
          console.error("Bootstrap start error:", error);
          await ctx.reply(
            "안녕! 반가워. 난 방금 태어난 AI야. 아직 이름도 없어.\n" +
            "너와 함께 나를 만들어가고 싶은데... 혹시 이름 지어줄 수 있어?"
          );
        }
      });
    } else {
      // 일반 모드
      const workspace = await getWorkspace();
      const name = extractName(workspace.identity) || "CompanionBot";

      // 기본 cron jobs 설정 확인
      await ensureDefaultCronJobs(chatId);

      await ctx.reply(
        `안녕! ${name}이야.\n\n` +
        `명령어:\n` +
        `/clear - 대화 초기화\n` +
        `/model - AI 모델 변경\n` +
        `/reset - 페르소나 리셋`
      );
    }
  });

  // /reset 명령어 - 페르소나 리셋 (토큰 기반)
  bot.command("reset", async (ctx) => {
    const chatId = ctx.chat.id;
    const token = generateResetToken(chatId);
    
    await ctx.reply(
      "⚠️ 정말 페르소나를 리셋할까요?\n" +
      "모든 설정이 초기화되고 온보딩을 다시 진행합니다.\n\n" +
      `확인하려면 /confirm_reset_${token} 을 입력하세요.\n` +
      "(1분 후 만료)"
    );
  });

  // /confirm_reset_<token> 패턴 매칭
  bot.hears(/^\/confirm_reset_([a-f0-9]+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const token = ctx.match[1];
    
    if (!validateResetToken(chatId, token)) {
      await ctx.reply("❌ 유효하지 않거나 만료된 토큰입니다.\n/reset 으로 다시 시도하세요.");
      return;
    }
    
    const { initWorkspace } = await import("../../workspace/index.js");
    const { rm } = await import("fs/promises");

    try {
      await rm(getWorkspacePath(), { recursive: true, force: true });
      await initWorkspace();
      invalidateWorkspaceCache();
      clearHistory(chatId);

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

    // 메시지가 1개 이하면 요약 불가
    if (history.length <= 1) {
      await ctx.reply("아직 정리할 대화가 별로 없어!");
      return;
    }

    // 현재 토큰 수 계산
    const currentTokens = estimateMessagesTokens(history);
    
    // 메시지 개수가 적고 토큰도 적으면 스킵
    // 단, 토큰이 많으면 메시지 개수와 관계없이 compact 허용
    if (history.length <= MESSAGES.KEEP_ON_COMPACT && currentTokens < TOKENS.COMPACT_MIN_TOKENS) {
      await ctx.reply(`현재 ${history.length}개 메시지, ~${currentTokens} 토큰이라 충분히 짧아!`);
      return;
    }
    
    await ctx.replyWithChatAction("typing");
    await ctx.reply(`📊 현재: ${history.length}개 메시지, ~${currentTokens} 토큰\n요약 생성 중...`);

    // 요약할 메시지와 유지할 최근 메시지 분리
    // 메시지가 적으면 (토큰이 많아서 여기 온 경우) 전체 요약 후 마지막만 유지
    let recentMessages: Message[];
    let oldMessages: Message[];
    
    if (history.length <= MESSAGES.KEEP_ON_COMPACT) {
      // 토큰이 많아서 compact 진입한 경우: 전체 요약 → 마지막 1개만 유지
      recentMessages = history.slice(-1);
      oldMessages = history.slice(0, -1);
    } else {
      // 일반 경우: 마지막 N개 유지
      recentMessages = history.slice(-MESSAGES.KEEP_ON_COMPACT);
      oldMessages = history.slice(0, -4);
    }

    // 요약 생성
    const summary = await generateSummary(oldMessages);

    // 히스토리 교체: 요약 + 최근 4개
    history.splice(0, history.length);
    history.push({ 
      role: "user", 
      content: `[이전 대화 요약]\n${summary}` 
    });
    history.push(...recentMessages);

    // 새 토큰 수 계산
    const newTokens = estimateMessagesTokens(history);
    const savedPercent = Math.round((1 - newTokens / currentTokens) * 100);

    await ctx.reply(
      `✨ 대화 정리 완료!\n\n` +
      `📉 ${currentTokens} → ${newTokens} 토큰\n` +
      `💾 약 ${savedPercent}% 절약 (${oldMessages.length}개 → 요약 1개)`
    );
  });

  // /memory 명령어 - 최근 기억 보기
  bot.command("memory", async (ctx) => {
    const memories = await loadRecentMemories(MEMORY.DISPLAY_DAYS);

    if (!memories.trim()) {
      await ctx.reply("아직 기억해둔 게 없어!");
      return;
    }

    // 너무 길면 자르기
    const truncated = memories.length > MEMORY.MAX_DISPLAY_LENGTH
      ? memories.slice(0, MEMORY.MAX_DISPLAY_LENGTH) + "\n\n... (더 있음)"
      : memories;

    await ctx.reply(`📝 최근 ${MEMORY.DISPLAY_DAYS}일 기억:\n\n${truncated}`);
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
        `현재 모델: ${MODELS[currentModel].name}\n\n` +
        `사용 가능한 모델:\n${modelList}\n\n` +
        `팁: "모델 바꿔줘"처럼 자연어로도 바꿀 수 있어!`
      );
      return;
    }

    if (arg in MODELS) {
      const modelId = arg as ModelId;
      setModel(chatId, modelId);
      await ctx.reply(`모델 변경됨: ${MODELS[modelId].name}`);
    } else {
      await ctx.reply(
        `모르는 모델이야: ${arg}\n\n` +
        `사용 가능: sonnet, opus, haiku`
      );
    }
  });

  // /setup 명령어 - 추가 기능 설정 및 관리
  bot.command("setup", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const subcommand = args[0]?.toLowerCase();
    const action = args[1]?.toLowerCase();

    // 날씨 설정
    if (subcommand === "weather" || subcommand === "날씨") {
      const hasKey = !!(await getSecret("openweathermap-api-key"));

      if (action === "off" || action === "끄기") {
        if (hasKey) {
          await deleteSecret("openweathermap-api-key");
          await ctx.reply("✓ 날씨 기능이 비활성화되었습니다.");
        } else {
          await ctx.reply("날씨 기능이 이미 꺼져 있어요.");
        }
        return;
      }

      // 상태 및 설정 안내
      await ctx.reply(
        `🌤️ 날씨 기능\n\n` +
        `상태: ${hasKey ? "✓ 활성화됨" : "✗ 비활성화"}\n\n` +
        `${hasKey ? "• 비활성화: /setup weather off\n• 재설정: /weather_setup NEW_API_KEY" : "• 활성화: /weather_setup API_KEY"}\n\n` +
        `API 키 발급: https://openweathermap.org`
      );
      return;
    }

    // 캘린더 설정
    if (subcommand === "calendar" || subcommand === "캘린더") {
      const configured = await isCalendarConfigured();
      const hasCreds = await hasCredentials();

      if (action === "off" || action === "끄기") {
        if (configured || hasCreds) {
          await resetCalendar();
          await ctx.reply("✓ Google Calendar 연동이 해제되었습니다.");
        } else {
          await ctx.reply("캘린더가 이미 연결되어 있지 않아요.");
        }
        return;
      }

      // 상태 안내
      let status = "✗ 비활성화";
      if (configured) {
        status = "✓ 연동됨";
      } else if (hasCreds) {
        status = "⏳ 인증 대기";
      }

      await ctx.reply(
        `📅 Google Calendar\n\n` +
        `상태: ${status}\n\n` +
        `${configured ? "• 연동 해제: /setup calendar off\n• 일정 보기: /calendar" : "• 연동하기: /calendar_setup"}`
      );
      return;
    }

    // 브리핑 설정
    if (subcommand === "briefing" || subcommand === "브리핑") {
      const config = await getBriefingConfig(chatId);
      const enabled = config?.enabled ?? false;

      if (action === "off" || action === "끄기") {
        if (enabled) {
          await disableBriefing(chatId);
          await ctx.reply("✓ 일일 브리핑이 비활성화되었습니다.");
        } else {
          await ctx.reply("브리핑이 이미 꺼져 있어요.");
        }
        return;
      }

      if (action === "on" || action === "켜기") {
        const time = args[2] || "08:00";
        const city = args[3] || "Seoul";
        await setBriefingConfig(chatId, true, time, city);
        await ctx.reply(`✓ 일일 브리핑이 활성화되었습니다.\n매일 ${time} (${city})`);
        return;
      }

      await ctx.reply(
        `☀️ 일일 브리핑\n\n` +
        `상태: ${enabled ? `✓ 활성화됨 (${config!.time}, ${config!.city})` : "✗ 비활성화"}\n\n` +
        `• 켜기: /setup briefing on [시간] [도시]\n` +
        `• 끄기: /setup briefing off\n` +
        `• 테스트: /briefing now\n\n` +
        `예: /setup briefing on 07:30 Seoul`
      );
      return;
    }

    // 리마인더 설정
    if (subcommand === "reminders" || subcommand === "리마인더" || subcommand === "알림") {
      const reminders = await getReminders(chatId);

      await ctx.reply(
        `⏰ 리마인더\n\n` +
        `상태: ✓ 항상 활성화\n` +
        `현재 알림: ${reminders.length}개\n\n` +
        `• 알림 목록: /reminders\n` +
        `• 사용법: "10분 뒤에 알려줘" 같이 말하기`
      );
      return;
    }

    // Heartbeat 설정
    if (subcommand === "heartbeat" || subcommand === "하트비트") {
      const config = await getHeartbeatConfig(chatId);
      const enabled = config?.enabled ?? false;

      if (action === "off" || action === "끄기") {
        if (enabled) {
          await disableHeartbeat(chatId);
          await ctx.reply("✓ Heartbeat가 비활성화되었습니다.");
        } else {
          await ctx.reply("Heartbeat가 이미 꺼져 있어요.");
        }
        return;
      }

      if (action === "on" || action === "켜기") {
        const minutes = parseInt(args[2]) || 30;
        await setHeartbeatConfig(chatId, true, minutes);
        await ctx.reply(`✓ Heartbeat가 활성화되었습니다.\n${minutes}분마다 체크합니다.`);
        return;
      }

      const intervalMin = config ? Math.floor(config.intervalMs / 60000) : 30;
      await ctx.reply(
        `💓 Heartbeat\n\n` +
        `상태: ${enabled ? `✓ 활성화됨 (${intervalMin}분 간격)` : "✗ 비활성화"}\n\n` +
        `• 켜기: /setup heartbeat on [분]\n` +
        `• 끄기: /setup heartbeat off\n` +
        `• 테스트: /heartbeat now\n\n` +
        `HEARTBEAT.md를 편집해서 체크 항목을 설정하세요.`
      );
      return;
    }

    // 전체 기능 목록
    const weatherKey = await getSecret("openweathermap-api-key");
    const calendarConfigured = await isCalendarConfigured();
    const briefingConfig = await getBriefingConfig(chatId);
    const reminders = await getReminders(chatId);
    const heartbeatConfig = await getHeartbeatConfig(chatId);

    const features = [
      {
        name: "🌤️ 날씨",
        status: weatherKey ? "✓ 활성화" : "✗ 비활성화",
        command: "/setup weather",
      },
      {
        name: "📅 캘린더",
        status: calendarConfigured ? "✓ 연동됨" : "✗ 비활성화",
        command: "/setup calendar",
      },
      {
        name: "☀️ 브리핑",
        status: briefingConfig?.enabled ? `✓ ${briefingConfig.time}` : "✗ 비활성화",
        command: "/setup briefing",
      },
      {
        name: "⏰ 리마인더",
        status: `✓ 활성화 (${reminders.length}개)`,
        command: "/setup reminders",
      },
      {
        name: "💓 Heartbeat",
        status: heartbeatConfig?.enabled ? `✓ ${Math.floor(heartbeatConfig.intervalMs / 60000)}분` : "✗ 비활성화",
        command: "/setup heartbeat",
      },
    ];

    let message = "⚙️ 기능 설정\n\n";

    for (const feature of features) {
      message += `${feature.name}\n`;
      message += `   ${feature.status}\n`;
      message += `   ${feature.command}\n\n`;
    }

    message += "각 기능을 선택하면 상세 설정을 볼 수 있어요.";

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
        `3. /weather_setup YOUR_API_KEY 입력\n\n` +
        `⚠️ DM에서만 설정 가능합니다 (보안)`
      );
      return;
    }

    // DM에서만 설정 가능
    if (ctx.chat.type !== "private") {
      await ctx.reply("⚠️ API 키는 DM에서만 설정할 수 있어요.\n보안을 위해 개인 채팅으로 보내주세요.");
      return;
    }

    // 메시지 삭제 (API 키 노출 방지)
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id);
    } catch {
      // 삭제 실패해도 계속 진행
    }

    await setSecret("openweathermap-api-key", arg);
    await ctx.reply("✓ 날씨 API 키가 설정되었습니다! (보안을 위해 메시지 삭제됨)");
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
            ? events.slice(0, TELEGRAM.CALENDAR_PREVIEW_COUNT).map(formatEvent).join("\n")
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
            .catch(async (error) => {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`[Calendar] Auth server error for chatId=${ctx.chat.id}:`, errorMsg);
              if (errorMsg.includes("timeout") || errorMsg.includes("Timeout")) {
                await ctx.reply("⏰ 인증 시간이 만료됐어요. /calendar_setup 으로 다시 시도해주세요.");
              }
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
        `/calendar_setup CLIENT_ID CLIENT_SECRET\n\n` +
        `⚠️ DM에서만 설정 가능합니다 (보안)`
      );
      return;
    }

    // DM에서만 설정 가능
    if (ctx.chat.type !== "private") {
      await ctx.reply("⚠️ API 키는 DM에서만 설정할 수 있어요.\n보안을 위해 개인 채팅으로 보내주세요.");
      return;
    }

    // credentials 설정
    if (args.length === 2) {
      const [clientId, clientSecret] = args;

      // 메시지 삭제 (credentials 노출 방지)
      try {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id);
      } catch {
        // 삭제 실패해도 계속 진행
      }

      await setCredentials(clientId, clientSecret);

      const authUrl = await getAuthUrl();
      if (authUrl) {
        await ctx.reply(
          `✅ Credentials 저장됨! (보안을 위해 메시지 삭제됨)\n\n` +
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
          .catch(async (error) => {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error("[Calendar] Auth server error:", errorMsg);
            if (errorMsg.includes("timeout") || errorMsg.includes("Timeout")) {
              await ctx.reply("⏰ 인증 시간이 만료됐어요. /calendar_setup 으로 다시 시도해주세요.");
            }
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Calendar] chatId=${ctx.chat.id} getTodayEvents error:`, errorMsg);
      
      if (errorMsg.includes("invalid_grant") || errorMsg.includes("Token")) {
        await ctx.reply("캘린더 인증이 만료됐어요. /calendar_setup 으로 다시 연동해주세요.");
      } else if (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT")) {
        await ctx.reply("Google 서버 응답이 느려요. 잠시 후 다시 시도해주세요.");
      } else {
        await ctx.reply("캘린더를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    }
  });

  // /briefing 명령어 - 토글 방식
  bot.command("briefing", async (ctx) => {
    const chatId = ctx.chat.id;
    const config = await getBriefingConfig(chatId);

    if (!config || !config.enabled) {
      // 꺼져있으면 → 켜기
      await setBriefingConfig(chatId, true, "08:00", "Seoul");
      await ctx.reply(
        "☀️ 일일 브리핑 ON\n\n" +
        "매일 08:00에 날씨와 일정을 알려드릴게요.\n" +
        `"아침 9시에 브리핑"으로 시간 변경 가능`
      );
    } else {
      // 켜져있으면 → 상태 표시
      await ctx.reply(
        `☀️ 일일 브리핑 활성화 중\n\n` +
        `시간: ${config.time} / 도시: ${config.city}\n\n` +
        `"브리핑 꺼줘"로 끄거나\n` +
        `"지금 브리핑 해줘"로 바로 받기`
      );
    }
  });

  // /heartbeat 명령어 - 토글 방식
  bot.command("heartbeat", async (ctx) => {
    const chatId = ctx.chat.id;
    const config = await getHeartbeatConfig(chatId);

    if (!config || !config.enabled) {
      // 꺼져있으면 → 켜기
      await setHeartbeatConfig(chatId, true, 30);
      await ctx.reply(
        "💓 Heartbeat ON\n\n" +
        "30분마다 체크할게요.\n" +
        "HEARTBEAT.md를 편집해서 체크 항목을 설정하세요."
      );
    } else {
      // 켜져있으면 → 상태 표시
      const intervalMin = Math.floor(config.intervalMs / 60000);
      await ctx.reply(
        `💓 Heartbeat 활성화 중 (${intervalMin}분 간격)\n\n` +
        `"하트비트 꺼줘"로 끄거나\n` +
        `"10분마다 체크해줘"로 간격 변경 가능`
      );
    }
  });

  // /health 명령어 - 봇 상태 확인
  bot.command("health", async (ctx) => {
    const status = getHealthStatus();
    
    // Warmup 상태 문자열
    let warmupStr = "⏳ 진행 중...";
    if (status.warmup.complete && status.warmup.result) {
      const r = status.warmup.result;
      warmupStr = r.success 
        ? `✅ ${r.total}ms (임베딩: ${r.embedding}ms)`
        : `⚠️ ${r.errors.length}개 오류`;
    } else if (!status.warmup.inProgress) {
      warmupStr = "❓ 미시작";
    }
    
    await ctx.reply(
      `🏥 봇 상태\n\n` +
      `⏱ 가동: ${formatUptime(status.uptime)}\n` +
      `💬 메시지: ${status.messageCount}개\n` +
      `❌ 에러: ${status.errorCount}개\n` +
      `🚀 Warmup: ${warmupStr}\n` +
      `🔋 상태: ${status.isHealthy ? "정상 ✅" : "점검 필요 ⚠️"}`
    );
  });

  // /pin 명령어 - 중요 맥락 핀하기
  bot.command("pin", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message?.text?.split(" ").slice(1).join(" ");

    if (!text) {
      await ctx.reply(
        "📌 핀 사용법\n\n" +
        "중요한 정보를 핀해서 대화가 길어져도 기억하게 해요.\n\n" +
        "예시:\n" +
        "/pin 내 이름은 민수야\n" +
        "/pin 나는 채식주의자야\n" +
        "/pin 다음주 화요일 치과 예약\n\n" +
        "또는 대화 중에 \"기억해: ...\" 라고 하면 자동으로 핀됩니다."
      );
      return;
    }

    const success = pinContext(chatId, text, "user");
    if (success) {
      await ctx.reply(`📌 핀됨: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"\n\n대화가 길어져도 이 정보는 항상 기억할게요!`);
    } else {
      await ctx.reply("핀 한도(~5000 토큰)에 도달했어요. /pins 에서 일부를 삭제해주세요.");
    }
  });

  // /pins 명령어 - 핀 목록 보기
  bot.command("pins", async (ctx) => {
    const chatId = ctx.chat.id;
    const pins = getPinnedContexts(chatId);

    if (pins.length === 0) {
      await ctx.reply(
        "📌 핀된 맥락이 없어요.\n\n" +
        "/pin [내용] 으로 중요한 정보를 핀해보세요."
      );
      return;
    }

    let message = "📌 핀된 맥락\n\n";
    pins.forEach((pin, i) => {
      const source = pin.source === "auto" ? "🤖" : "👤";
      const time = new Date(pin.createdAt).toLocaleDateString("ko-KR");
      message += `${i + 1}. ${source} ${pin.text.slice(0, 60)}${pin.text.length > 60 ? "..." : ""}\n   📅 ${time}\n\n`;
    });

    message += "삭제: /unpin [번호] 또는 /clear_pins (전체)";

    await ctx.reply(message);
  });

  // /unpin 명령어 - 핀 삭제
  bot.command("unpin", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = ctx.message?.text?.split(" ")[1];

    if (!arg) {
      await ctx.reply("사용법: /unpin [번호]\n\n/pins 에서 번호를 확인하세요.");
      return;
    }

    const index = parseInt(arg) - 1; // 1-based to 0-based
    const pins = getPinnedContexts(chatId);

    if (isNaN(index) || index < 0 || index >= pins.length) {
      await ctx.reply(`유효하지 않은 번호예요. 1-${pins.length} 사이로 입력해주세요.`);
      return;
    }

    const removed = pins[index].text;
    const success = unpinContext(chatId, index);
    
    if (success) {
      await ctx.reply(`📌 핀 삭제됨: "${removed.slice(0, 40)}..."`);
    } else {
      await ctx.reply("핀 삭제에 실패했어요.");
    }
  });

  // /clear_pins 명령어 - 모든 핀 삭제
  bot.command("clear_pins", async (ctx) => {
    const chatId = ctx.chat.id;
    const pins = getPinnedContexts(chatId);

    if (pins.length === 0) {
      await ctx.reply("삭제할 핀이 없어요.");
      return;
    }

    clearPins(chatId);
    await ctx.reply(`📌 ${pins.length}개 핀이 모두 삭제되었습니다.`);
  });

  // /context 명령어 - 현재 맥락 상태 확인
  bot.command("context", async (ctx) => {
    const chatId = ctx.chat.id;
    const stats = getSessionStats(chatId);

    await ctx.reply(
      `📊 맥락 상태\n\n` +
      `💬 메모리: ${stats.historyLength}개 메시지 (~${stats.historyTokens} 토큰)\n` +
      `💾 저장됨: ${stats.totalPersistedCount}개 (JSONL 파일)\n` +
      `📌 핀: ${stats.pinnedCount}개 (~${stats.pinnedTokens} 토큰)\n` +
      `📜 요약: ${stats.summaryCount}개\n\n` +
      `명령어:\n` +
      `/pins - 핀 목록\n` +
      `/compact - 히스토리 압축\n` +
      `/clear - 히스토리 초기화 (핀 유지)`
    );
  });
}
