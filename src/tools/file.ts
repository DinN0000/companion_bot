/**
 * File operation tools
 */

import * as fs from "fs/promises";
import * as path from "path";
import { isPathAllowed } from "./pathCheck.js";

// read_file
export async function executeReadFile(input: Record<string, unknown>): Promise<string> {
  const filePath = input.path as string;
  if (!isPathAllowed(filePath)) {
    return `Error: Access denied. Path not in allowed directories.`;
  }
  const content = await fs.readFile(filePath, "utf-8");
  return content;
}

// write_file
export async function executeWriteFile(input: Record<string, unknown>): Promise<string> {
  const filePath = input.path as string;
  const content = input.content as string;
  if (!isPathAllowed(filePath)) {
    return `Error: Access denied. Path not in allowed directories.`;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return `File written successfully: ${filePath}`;
}

// edit_file
export async function executeEditFile(input: Record<string, unknown>): Promise<string> {
  const filePath = input.path as string;
  const oldText = input.oldText as string;
  const newText = input.newText as string;

  if (!isPathAllowed(filePath)) {
    return `Error: Access denied. Path not in allowed directories.`;
  }

  // 파일 읽기
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    return `Error: Could not read file "${filePath}". ${error instanceof Error ? error.message : String(error)}`;
  }

  // oldText 찾기
  const index = content.indexOf(oldText);
  if (index === -1) {
    return `Error: oldText not found in file. Make sure the text matches exactly (including whitespace).`;
  }

  // 첫 번째만 교체
  const newContent = content.slice(0, index) + newText + content.slice(index + oldText.length);

  // 저장
  await fs.writeFile(filePath, newContent, "utf-8");
  return `File edited successfully: ${filePath}`;
}

// list_directory
export async function executeListDirectory(input: Record<string, unknown>): Promise<string> {
  const dirPath = input.path as string;
  if (!isPathAllowed(dirPath)) {
    return `Error: Access denied. Path not in allowed directories.`;
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const list = entries.map((e) =>
    `${e.isDirectory() ? "📁" : "📄"} ${e.name}`
  );
  return list.join("\n");
}
