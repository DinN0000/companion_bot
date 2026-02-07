import * as path from "path";
import * as os from "os";

// 워크스페이스 기본 경로
const WORKSPACE_DIR = ".companionbot";

export function getWorkspacePath(): string {
  return path.join(os.homedir(), WORKSPACE_DIR);
}

export function getWorkspaceFilePath(filename: string): string {
  return path.join(getWorkspacePath(), filename);
}

export function getMemoryDirPath(): string {
  return path.join(getWorkspacePath(), "memory");
}

export function getDailyMemoryPath(date?: Date): string {
  const d = date || new Date();
  const dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(getMemoryDirPath(), `${dateStr}.md`);
}

// 템플릿 경로 (패키지 내부)
export function getTemplatesPath(): string {
  // ESM에서 __dirname 대체
  const currentDir = new URL(".", import.meta.url).pathname;
  return path.resolve(currentDir, "../../templates");
}

// 워크스페이스 파일 목록
export const WORKSPACE_FILES = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
] as const;

export type WorkspaceFile = (typeof WORKSPACE_FILES)[number];
