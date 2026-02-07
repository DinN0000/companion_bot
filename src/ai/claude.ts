import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool } from "../tools/index.js";

let anthropic: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic();
  }
  return anthropic;
}

export type Message = {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlock[] | Anthropic.ContentBlockParam[];
};

export type ImageData = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

export type ModelId = "sonnet" | "opus" | "haiku";

export const MODELS: Record<ModelId, { id: string; name: string }> = {
  sonnet: { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  opus: { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
  haiku: { id: "claude-haiku-3-5-20241022", name: "Claude Haiku 3.5" },
};

export async function chat(
  messages: Message[],
  systemPrompt?: string,
  modelId: ModelId = "sonnet"
): Promise<string> {
  const client = getClient();
  const model = MODELS[modelId].id;

  // 메시지를 API 형식으로 변환
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: apiMessages,
    tools: tools,
  });

  // Tool use 루프 - Claude가 도구 사용을 멈출 때까지 반복
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    // 도구 실행 결과 수집
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      console.log(`[Tool] ${toolUse.name}:`, JSON.stringify(toolUse.input));

      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>
      );

      // 결과가 너무 길면 자르기
      const truncatedResult =
        result.length > 10000
          ? result.slice(0, 10000) + "\n... (truncated)"
          : result;

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: truncatedResult,
      });
    }

    // 어시스턴트 메시지와 도구 결과 추가
    apiMessages.push({
      role: "assistant",
      content: response.content,
    });

    apiMessages.push({
      role: "user",
      content: toolResults,
    });

    // 다음 응답 요청
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
      tools: tools,
    });
  }

  // 최종 텍스트 응답 추출
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );

  return textBlock?.text ?? "";
}
