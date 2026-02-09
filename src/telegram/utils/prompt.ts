import { MODELS, type ModelId } from "../../ai/claude.js";
import { loadRecentMemories, getWorkspacePath } from "../../workspace/index.js";
import { getToolsDescription } from "../../tools/index.js";
import { getWorkspace } from "./cache.js";

/**
 * identity.md에서 이름을 추출합니다.
 */
export function extractName(identityContent: string | null): string | null {
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

/**
 * 현재 날짜/시간을 한국어 포맷으로 반환합니다.
 */
function getKoreanDateTime(): { formatted: string; timezone: string } {
  const now = new Date();
  const timezone = "Asia/Seoul";

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const formatted = formatter.format(now);

  return {
    formatted,
    timezone: `${timezone} (GMT+9)`,
  };
}

/**
 * 시스템 프롬프트를 동적으로 생성합니다.
 */
export async function buildSystemPrompt(modelId: ModelId): Promise<string> {
  const model = MODELS[modelId];
  const workspace = await getWorkspace();
  const parts: string[] = [];

  // 기본 정보
  parts.push(`You are a personal AI companion running on ${model.name}.`);
  parts.push(`Workspace: ${getWorkspacePath()}`);

  // 런타임 정보 (날짜/시간)
  const dateTime = getKoreanDateTime();
  parts.push(`Current time: ${dateTime.formatted}`);
  parts.push(`Timezone: ${dateTime.timezone}`);

  // 채널/플랫폼 정보
  parts.push(`Runtime: channel=telegram | capabilities=markdown,inline_keyboard,reactions | version=0.4.x`);

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
