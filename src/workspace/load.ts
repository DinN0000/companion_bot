import * as fs from "fs/promises";
import * as path from "path";
import { getWorkspacePath, getWorkspaceFilePath, getDailyMemoryPath } from "./paths.js";

export interface Workspace {
  agents: string | null;
  bootstrap: string | null;
  identity: string | null;
  soul: string | null;
  user: string | null;
  memory: string | null;
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function loadWorkspace(): Promise<Workspace> {
  const workspacePath = getWorkspacePath();

  const [agents, bootstrap, identity, soul, user, memory] = await Promise.all([
    readFileOrNull(path.join(workspacePath, "AGENTS.md")),
    readFileOrNull(path.join(workspacePath, "BOOTSTRAP.md")),
    readFileOrNull(path.join(workspacePath, "IDENTITY.md")),
    readFileOrNull(path.join(workspacePath, "SOUL.md")),
    readFileOrNull(path.join(workspacePath, "USER.md")),
    readFileOrNull(path.join(workspacePath, "MEMORY.md")),
  ]);

  return { agents, bootstrap, identity, soul, user, memory };
}

export async function loadBootstrap(): Promise<string | null> {
  return readFileOrNull(getWorkspaceFilePath("BOOTSTRAP.md"));
}

export async function saveWorkspaceFile(
  filename: string,
  content: string
): Promise<void> {
  const filePath = getWorkspaceFilePath(filename);
  await fs.writeFile(filePath, content, "utf-8");
}

export async function appendToMemory(content: string): Promise<void> {
  const memoryPath = getDailyMemoryPath();
  const timestamp = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  const entry = `\n## ${timestamp}\n${content}\n`;

  try {
    await fs.appendFile(memoryPath, entry, "utf-8");
  } catch {
    // 파일이 없으면 헤더와 함께 생성
    const date = new Date().toLocaleDateString("ko-KR");
    const header = `# ${date} 기억\n`;
    await fs.writeFile(memoryPath, header + entry, "utf-8");
  }
}

export async function loadRecentMemories(days: number = 7): Promise<string> {
  const memories: string[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const memoryPath = getDailyMemoryPath(date);

    const content = await readFileOrNull(memoryPath);
    if (content) {
      memories.push(content);
    }
  }

  return memories.join("\n\n---\n\n");
}
