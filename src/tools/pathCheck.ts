/**
 * Path validation utilities for security
 * 보안 크리티컬 - 허용된 경로만 접근 가능하도록 검증
 *
 * OpenClaw 스타일 보안 모델:
 * - workspace 기반 제한 (홈 전체 X)
 * - O_NOFOLLOW로 심볼릭 링크 차단
 * - inode 비교로 TOCTOU 방어
 */

import * as fs from "fs";
import * as path from "path";
import { constants as fsConstants } from "fs";
import { getWorkspacePath } from "../workspace/index.js";

// 위험한 파일 패턴 (추가 보호)
export const DANGEROUS_PATTERNS = [
  /\.bashrc$/,
  /\.zshrc$/,
  /\.bash_profile$/,
  /\.profile$/,
  /\.ssh\//,
  /\.git\/hooks\//,
  /\.git\/config$/,
  /\.env$/,
  /\.npmrc$/,
];

/**
 * 허용된 디렉토리 목록 반환
 * OpenClaw 스타일: workspace 기반 제한
 */
export function getAllowedPaths(): string[] {
  return [
    getWorkspacePath(), // ~/.companionbot
    "/tmp", // 임시 디렉토리
  ];
}

/**
 * O_NOFOLLOW 지원 여부 확인
 */
const supportsNoFollow =
  process.platform !== "win32" && "O_NOFOLLOW" in fsConstants;

/**
 * 경로가 root 디렉토리 내에 있는지 확인
 * trailing separator로 정확한 비교
 */
function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  return (
    targetPath === normalizedRoot || targetPath.startsWith(rootWithSep)
  );
}

/**
 * 주어진 경로가 허용된 디렉토리 내에 있는지 검증
 *
 * OpenClaw 스타일 보안:
 * - O_NOFOLLOW로 심볼릭 링크 open 차단 (Unix)
 * - inode/device 비교로 TOCTOU 방어
 * - 위험한 파일 패턴 차단
 */
export function isPathAllowed(
  targetPath: string,
  allowedPaths?: string[]
): boolean {
  try {
    const resolved = path.resolve(targetPath);

    // 1. 위험한 파일 패턴 차단
    if (DANGEROUS_PATTERNS.some((p) => p.test(resolved))) {
      return false;
    }

    const allowed = allowedPaths ?? getAllowedPaths();

    // 2. 파일이 존재하는 경우: 강화된 검증
    if (fs.existsSync(resolved)) {
      return verifyExistingPath(resolved, allowed);
    }

    // 3. 파일이 없는 경우 (write용): 부모 디렉토리 검증
    return verifyParentPath(resolved, allowed);
  } catch {
    // 어떤 예외든 검증 실패로 처리 (fail-safe)
    return false;
  }
}

/**
 * 존재하는 파일/디렉토리 검증
 * O_NOFOLLOW + inode 비교로 TOCTOU 방어
 */
function verifyExistingPath(resolved: string, allowed: string[]): boolean {
  try {
    // lstat으로 심볼릭 링크 감지
    const lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) {
      // 심볼릭 링크는 realpath로 실제 경로 확인
      const realPath = fs.realpathSync(resolved);
      if (!allowed.some((root) => isWithinRoot(realPath, root))) {
        return false;
      }
      // 실제 경로도 위험 패턴 체크
      if (DANGEROUS_PATTERNS.some((p) => p.test(realPath))) {
        return false;
      }
    }

    // O_NOFOLLOW로 파일 열어서 inode 확인 (TOCTOU 방어)
    if (supportsNoFollow && lstat.isFile()) {
      let fd: number | null = null;
      try {
        fd = fs.openSync(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const fstat = fs.fstatSync(fd);

        // inode/device 비교
        if (fstat.ino !== lstat.ino || fstat.dev !== lstat.dev) {
          return false; // 파일이 바뀌었음 (TOCTOU)
        }
      } catch (err: unknown) {
        // ELOOP = 심볼릭 링크를 O_NOFOLLOW로 열려고 함
        if (err && typeof err === "object" && "code" in err && err.code === "ELOOP") {
          // 위에서 이미 realpath 검증했으므로 통과
        } else {
          return false;
        }
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
            // ignore
          }
        }
      }
    }

    // 최종 경로 검증
    const realPath = fs.realpathSync(resolved);
    return allowed.some((root) => isWithinRoot(realPath, root));
  } catch {
    return false;
  }
}

/**
 * 존재하지 않는 파일의 부모 디렉토리 검증 (write용)
 */
function verifyParentPath(resolved: string, allowed: string[]): boolean {
  try {
    const parentDir = path.dirname(resolved);

    // 부모 디렉토리가 존재하는지 확인
    if (!fs.existsSync(parentDir)) {
      // 부모도 없으면 더 상위로
      return verifyParentPath(parentDir, allowed);
    }

    // 부모 디렉토리의 realpath 확인
    const realParent = fs.realpathSync(parentDir);
    const targetReal = path.join(realParent, path.basename(resolved));

    return allowed.some((root) => isWithinRoot(targetReal, root));
  } catch {
    return false;
  }
}

/**
 * 읽기용 안전한 파일 열기 (OpenClaw fs-safe 스타일)
 * 파일 핸들과 검증된 realPath 반환
 */
export function safeOpenForRead(
  targetPath: string,
  allowedPaths?: string[]
): { fd: number; realPath: string; stat: fs.Stats } | null {
  try {
    const resolved = path.resolve(targetPath);
    const allowed = allowedPaths ?? getAllowedPaths();

    // 위험 패턴 체크
    if (DANGEROUS_PATTERNS.some((p) => p.test(resolved))) {
      return null;
    }

    // O_NOFOLLOW로 열기 시도
    const flags = fsConstants.O_RDONLY | (supportsNoFollow ? fsConstants.O_NOFOLLOW : 0);
    let fd: number;

    try {
      fd = fs.openSync(resolved, flags);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ELOOP") {
        // 심볼릭 링크 - realpath로 검증 후 일반 open
        const realPath = fs.realpathSync(resolved);
        if (!allowed.some((root) => isWithinRoot(realPath, root))) {
          return null;
        }
        if (DANGEROUS_PATTERNS.some((p) => p.test(realPath))) {
          return null;
        }
        fd = fs.openSync(realPath, fsConstants.O_RDONLY);
      } else {
        return null;
      }
    }

    try {
      const stat = fs.fstatSync(fd);

      // 파일인지 확인
      if (!stat.isFile()) {
        fs.closeSync(fd);
        return null;
      }

      // realpath 확인
      const realPath = fs.realpathSync(resolved);
      if (!allowed.some((root) => isWithinRoot(realPath, root))) {
        fs.closeSync(fd);
        return null;
      }

      // inode 비교 (TOCTOU 방어)
      const realStat = fs.statSync(realPath);
      if (stat.ino !== realStat.ino || stat.dev !== realStat.dev) {
        fs.closeSync(fd);
        return null;
      }

      return { fd, realPath, stat };
    } catch {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
      return null;
    }
  } catch {
    return null;
  }
}
