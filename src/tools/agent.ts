/**
 * Sub-agent tools
 */

import { getCurrentChatId } from "../session/state.js";
import {
  spawnAgent,
  listAgents,
  cancelAgent,
} from "../agents/index.js";

// spawn_agent
export async function executeSpawnAgent(input: Record<string, unknown>): Promise<string> {
  const chatId = getCurrentChatId();
  if (!chatId) {
    return "Error: No active chat session";
  }

  const task = input.task as string;
  if (!task || task.trim().length === 0) {
    return "Error: Task description is required";
  }

  const agentId = await spawnAgent(task, chatId);
  return `Sub-agent spawned! 🤖\nID: ${agentId}\nTask: ${task.slice(0, 100)}${task.length > 100 ? "..." : ""}\n\nThe agent is working in the background. Results will be sent to this chat when complete.`;
}

// list_agents
export function executeListAgents(): string {
  const chatId = getCurrentChatId();
  const agents = listAgents(chatId || undefined);

  if (agents.length === 0) {
    return "No sub-agents found.";
  }

  const lines = agents.map((a) => {
    const status = {
      running: "🔄 Running",
      completed: "✅ Completed",
      failed: "❌ Failed",
      cancelled: "⏹️ Cancelled",
    }[a.status];

    const time = a.completedAt
      ? `(${Math.round((a.completedAt.getTime() - a.createdAt.getTime()) / 1000)}s)`
      : "";

    return `${a.id}: ${status} ${time}\n   Task: ${a.task.slice(0, 60)}${a.task.length > 60 ? "..." : ""}`;
  });

  return `Sub-agents:\n${lines.join("\n\n")}`;
}

// cancel_agent
export function executeCancelAgent(input: Record<string, unknown>): string {
  const agentId = input.agent_id as string;
  if (!agentId) {
    return "Error: Agent ID is required";
  }

  const success = cancelAgent(agentId);
  if (success) {
    return `Sub-agent ${agentId} cancelled.`;
  } else {
    return `Could not cancel agent ${agentId}. It may not exist or already completed.`;
  }
}
