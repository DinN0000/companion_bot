import * as fs from "fs/promises";
import * as path from "path";
import {
  getWorkspacePath,
  getTemplatesPath,
  getMemoryDirPath,
  WORKSPACE_FILES,
} from "./paths.js";

export async function isWorkspaceInitialized(): Promise<boolean> {
  try {
    const workspacePath = getWorkspacePath();
    await fs.access(workspacePath);

    // IDENTITY.md가 있으면 초기화된 것으로 간주
    const identityPath = path.join(workspacePath, "IDENTITY.md");
    await fs.access(identityPath);

    return true;
  } catch {
    return false;
  }
}

export async function initWorkspace(): Promise<void> {
  const workspacePath = getWorkspacePath();
  const templatesPath = getTemplatesPath();
  const memoryPath = getMemoryDirPath();

  // 워크스페이스 디렉토리 생성
  await fs.mkdir(workspacePath, { recursive: true });

  // 메모리 디렉토리 생성
  await fs.mkdir(memoryPath, { recursive: true });

  // 템플릿 파일 복사
  for (const file of WORKSPACE_FILES) {
    const srcPath = path.join(templatesPath, file);
    const destPath = path.join(workspacePath, file);

    try {
      // 대상 파일이 이미 존재하면 건너뛰기
      await fs.access(destPath);
    } catch {
      // 파일이 없으면 복사
      try {
        const content = await fs.readFile(srcPath, "utf-8");
        await fs.writeFile(destPath, content, "utf-8");
      } catch (err) {
        console.error(`Warning: Could not copy ${file}:`, err);
      }
    }
  }
}

export async function hasBootstrap(): Promise<boolean> {
  try {
    const bootstrapPath = path.join(getWorkspacePath(), "BOOTSTRAP.md");
    await fs.access(bootstrapPath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteBootstrap(): Promise<void> {
  try {
    const bootstrapPath = path.join(getWorkspacePath(), "BOOTSTRAP.md");
    await fs.unlink(bootstrapPath);
  } catch {
    // 파일이 없어도 무시
  }
}
