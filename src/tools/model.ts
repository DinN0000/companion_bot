/**
 * Model change tool
 */

import { MODELS, type ModelId } from "../ai/claude.js";
import { getCurrentChatId, setModel, getModel } from "../session/state.js";

// change_model
export function executeChangeModel(input: Record<string, unknown>): string {
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
  setModel(chatId, modelId);

  const newModel = MODELS[modelId];
  return `Model changed: ${MODELS[oldModel].name} → ${newModel.name}${reason ? ` (${reason})` : ""}. The change will take effect from the next message.`;
}
