# Session Persistence (장기 기억) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 봇 재시작 후에도 대화 기록과 모델 선택이 유지되도록 JSONL 파일로 세션을 저장한다.

**Architecture:** 각 chatId별로 별도의 JSONL 파일을 생성하여 메시지를 저장. 봇 시작 시 기존 파일에서 히스토리 로드. 메시지 추가될 때마다 파일에 append.

**Tech Stack:** Node.js fs/promises, JSONL format (한 줄에 하나의 JSON 객체)

---

## Task 1: Create data directory structure

**Files:**
- Create: `data/sessions/.gitkeep`
- Modify: `.gitignore`

**Step 1: Create data directory**

```bash
mkdir -p data/sessions
touch data/sessions/.gitkeep
```

**Step 2: Update .gitignore**

Add to `.gitignore`:
```
# Session data (contains conversation history)
data/sessions/*.jsonl
```

**Step 3: Commit**

```bash
git add data/sessions/.gitkeep .gitignore
git commit -m "chore: add data/sessions directory for persistence"
```

---

## Task 2: Create session storage module

**Files:**
- Create: `src/session/storage.ts`

**Step 1: Write the storage module**

```typescript
import * as fs from "fs/promises";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "sessions");

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface SessionData {
  chatId: number;
  modelId: string;
  messages: StoredMessage[];
}

function getSessionPath(chatId: number): string {
  return path.join(DATA_DIR, `${chatId}.jsonl`);
}

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadSession(chatId: number): Promise<SessionData | null> {
  const filePath = getSessionPath(chatId);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    if (lines.length === 0) return null;

    // First line is metadata
    const metadata = JSON.parse(lines[0]) as { modelId: string };

    // Rest are messages
    const messages: StoredMessage[] = lines.slice(1).map((line) => JSON.parse(line));

    return {
      chatId,
      modelId: metadata.modelId,
      messages,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveMetadata(chatId: number, modelId: string): Promise<void> {
  await ensureDataDir();
  const filePath = getSessionPath(chatId);

  // Load existing messages
  const existing = await loadSession(chatId);
  const messages = existing?.messages || [];

  // Rewrite file with new metadata
  const lines = [
    JSON.stringify({ modelId }),
    ...messages.map((m) => JSON.stringify(m)),
  ];

  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

export async function appendMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await ensureDataDir();
  const filePath = getSessionPath(chatId);

  // Ensure file exists with metadata
  try {
    await fs.access(filePath);
  } catch {
    await saveMetadata(chatId, "sonnet");
  }

  const message: StoredMessage = {
    role,
    content,
    timestamp: Date.now(),
  };

  await fs.appendFile(filePath, JSON.stringify(message) + "\n", "utf-8");
}

export async function clearSession(chatId: number): Promise<void> {
  const filePath = getSessionPath(chatId);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/session/storage.ts
git commit -m "feat: add session storage module for JSONL persistence"
```

---

## Task 3: Integrate storage with state module

**Files:**
- Modify: `src/session/state.ts`

**Step 1: Update state.ts to use storage**

Replace entire `src/session/state.ts` with:

```typescript
import type { ModelId, Message } from "../ai/claude.js";
import {
  loadSession,
  saveMetadata,
  appendMessage,
  clearSession,
  type StoredMessage,
} from "./storage.js";

// In-memory cache
const sessions = new Map<number, Message[]>();
const sessionModels = new Map<number, ModelId>();
const loadedSessions = new Set<number>();

// Convert stored messages to API format
function storedToApiMessages(stored: StoredMessage[]): Message[] {
  return stored.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export async function initSession(chatId: number): Promise<void> {
  if (loadedSessions.has(chatId)) return;

  const data = await loadSession(chatId);

  if (data) {
    sessions.set(chatId, storedToApiMessages(data.messages));
    sessionModels.set(chatId, data.modelId as ModelId);
  } else {
    sessions.set(chatId, []);
    sessionModels.set(chatId, "sonnet");
  }

  loadedSessions.add(chatId);
}

export function getHistory(chatId: number): Message[] {
  let history = sessions.get(chatId);
  if (!history) {
    history = [];
    sessions.set(chatId, history);
  }
  return history;
}

export async function addMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const history = getHistory(chatId);
  history.push({ role, content });

  // Persist to file
  await appendMessage(chatId, role, content);
}

export async function clearHistory(chatId: number): Promise<void> {
  sessions.delete(chatId);
  loadedSessions.delete(chatId);
  await clearSession(chatId);
}

export function getModel(chatId: number): ModelId {
  return sessionModels.get(chatId) || "sonnet";
}

export async function setModel(chatId: number, modelId: ModelId): Promise<void> {
  sessionModels.set(chatId, modelId);
  await saveMetadata(chatId, modelId);
}

// 현재 활성 chatId (도구에서 사용)
let currentChatId: number | null = null;

export function setCurrentChatId(chatId: number): void {
  currentChatId = chatId;
}

export function getCurrentChatId(): number | null {
  return currentChatId;
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/session/state.ts
git commit -m "feat: integrate JSONL storage with session state"
```

---

## Task 4: Update bot.ts to use async session functions

**Files:**
- Modify: `src/telegram/bot.ts`

**Step 1: Update bot.ts**

Changes needed:
1. Import `initSession` and `addMessage`
2. Call `initSession` at start of message handler
3. Use `addMessage` instead of direct push
4. Make `clearHistory` and `setModel` calls await

Replace the message handler section in `bot.ts`:

```typescript
import { Bot } from "grammy";
import { chat, MODELS, type Message, type ModelId } from "../ai/claude.js";
import {
  getHistory,
  clearHistory,
  getModel,
  setModel,
  setCurrentChatId,
  initSession,
  addMessage,
} from "../session/state.js";

function getSystemPrompt(modelId: ModelId): string {
  const model = MODELS[modelId];
  return `You are CompanionBot, powered by ${model.name} (${model.id}).

You can:
- Read files: Use read_file to view code, documents, or any text file
- Write files: Use write_file to create or modify files
- List directories: Use list_directory to explore folder structures
- Run commands: Use run_command for git, npm, and other safe commands
- Change model: Use change_model to switch AI models

Allowed directories: ~/Documents, ~/projects

Current model: ${model.name}
Available models:
- sonnet: Claude Sonnet 4 (balanced, default)
- opus: Claude Opus 4 (most capable, complex tasks)
- haiku: Claude Haiku 3.5 (fast, simple tasks)

You can proactively switch models when appropriate:
- Switch to opus for complex coding or deep analysis
- Switch to haiku for simple questions or casual chat
- Stay on sonnet for general tasks

When asked about yourself, tell the user you are ${model.name}.
Be helpful, concise, and use tools when needed.`;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // 에러 핸들링
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  // /start 명령어
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    await clearHistory(chatId);
    await setModel(chatId, "sonnet");

    const model = MODELS["sonnet"];
    await ctx.reply(
      `Hello! I'm CompanionBot (${model.name})\n\n` +
      `Commands:\n` +
      `/clear - Start new conversation\n` +
      `/model - Change AI model\n\n` +
      `I can read/write files, run commands, and switch models automatically based on task complexity!`
    );
  });

  // /clear 명령어 - 대화 기록 초기화
  bot.command("clear", async (ctx) => {
    const chatId = ctx.chat.id;
    await clearHistory(chatId);
    await ctx.reply("Conversation cleared. Let's start fresh!");
  });

  // /model 명령어 - 모델 변경
  bot.command("model", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = ctx.message.text.split(" ")[1]?.toLowerCase();

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
      await setModel(chatId, modelId);
      await ctx.reply(`Model changed to: ${MODELS[modelId].name}`);
    } else {
      await ctx.reply(
        `Unknown model: ${arg}\n\n` +
        `Available: sonnet, opus, haiku`
      );
    }
  });

  // 일반 메시지 처리
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // 세션 초기화 (파일에서 로드)
    await initSession(chatId);

    // 현재 chatId 설정 (도구에서 사용)
    setCurrentChatId(chatId);

    // 세션 가져오기
    const history = getHistory(chatId);
    const modelId = getModel(chatId);

    // 사용자 메시지 추가 (파일에도 저장)
    await addMessage(chatId, "user", userMessage);

    // 타이핑 표시
    await ctx.replyWithChatAction("typing");

    try {
      // Claude에게 요청
      const response = await chat(history, getSystemPrompt(modelId), modelId);

      // 응답 추가 (파일에도 저장)
      await addMessage(chatId, "assistant", response);

      // 히스토리 제한 (최근 20개 메시지만 유지)
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      // 응답 전송
      await ctx.reply(response);
    } catch (error) {
      console.error("Chat error:", error);
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  return bot;
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/telegram/bot.ts
git commit -m "feat: integrate async session persistence in bot"
```

---

## Task 5: Update tools to use async setModel

**Files:**
- Modify: `src/tools/index.ts`

**Step 1: Update change_model tool**

In `src/tools/index.ts`, update the `change_model` case in `executeTool`:

```typescript
      case "change_model": {
        const modelId = input.model as ModelId;
        const reason = input.reason as string || "";
        const chatId = getCurrentChatId();

        if (!chatId) {
          return "Error: No active chat session";
        }

        if (!(modelId in MODELS)) {
          return `Error: Unknown model "${modelId}". Available: sonnet, opus, haiku`;
        }

        const oldModel = getModel(chatId);
        await setModel(chatId, modelId);

        const newModel = MODELS[modelId];
        return `Model changed: ${MODELS[oldModel].name} → ${newModel.name}${reason ? ` (${reason})` : ""}. The change will take effect from the next message.`;
      }
```

Also update the import at the top:

```typescript
import { getCurrentChatId, setModel, getModel } from "../session/state.js";
```

Note: `setModel` is now async, so `executeTool` needs to await it. The function is already async.

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat: update tools to use async setModel"
```

---

## Task 6: Test the persistence

**Step 1: Start the bot**

```bash
npm run dev
```

**Step 2: Send test messages in Telegram**

1. Send "안녕 나 테스트 중이야"
2. Send "내가 방금 뭐라고 했지?"
3. Bot should remember and respond correctly

**Step 3: Restart the bot (Ctrl+C and npm run dev again)**

**Step 4: Send another message**

1. Send "내가 아까 뭐라고 했지?"
2. Bot should remember the conversation from before restart

**Step 5: Verify JSONL file created**

```bash
ls -la data/sessions/
cat data/sessions/*.jsonl
```

Expected: File exists with conversation history

**Step 6: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: session persistence complete"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create data directory structure |
| 2 | Create session storage module |
| 3 | Integrate storage with state module |
| 4 | Update bot.ts to use async session functions |
| 5 | Update tools to use async setModel |
| 6 | Test the persistence |
