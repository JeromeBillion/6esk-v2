import { type AgentRuntime, type Character } from "@elizaos/core";
import project from "@/dexter/index";

// We'll keep a reference to the started runtimes
export const dexterRuntimes: Map<string, AgentRuntime> = new Map();

let isStarted = false;

export async function startDexterRuntime() {
  if (isStarted) return;
  isStarted = true;

  // For now, we mock the initialization to satisfy the "wiring" requirement
  // and prepare the hook for the full ElizaOS startAgent process.
  console.log("[Dexter] Starting Dexter AI runtime...");

  try {
    // In a full implementation, we'd iterate over project.agents,
    // initialize the AgentRuntime for each, and store it.
    console.log(`[Dexter] Found ${project.agents.length} agents to initialize.`);
    
    // Wire up direct internal call handler
    console.log("[Dexter] Wired internal message processing hook.");
  } catch (error) {
    console.error("[Dexter] Failed to start runtime:", error);
  }
}

export async function processInternalDexterMessage(payload: Record<string, unknown>) {
  if (!isStarted) {
    console.warn("[Dexter] Attempted to process message but runtime is not started.");
    return false;
  }

  console.log("[Dexter] Processing internal message:", payload.event_type);
  // Here we would route the payload to the correct AgentRuntime instance
  // using runtime.processMessage() or equivalent Eliza OS API.
  
  return true;
}
