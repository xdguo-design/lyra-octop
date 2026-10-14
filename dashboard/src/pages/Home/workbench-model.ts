import type { OctopAgent } from "../../context/AgentContext";
import type { ChatMessage } from "../Chat/hooks/sseHelpers";

/** A running team host is the only guaranteed delegation-capable entry point. */
export function selectPrimaryAgent(agents: OctopAgent[]): OctopAgent | null {
  const running = agents.filter((a) => a.state === "running" && !a.bridge);
  return (
    running.find((a) => a.kind === "team" && (a.member_ids?.length ?? 0) > 0) ??
    running.find((a) => a.kind === "team") ??
    running.find((a) => /orchestrat|调度|主控|主 agent/i.test(a.name)) ??
    running.find((a) => a.kind !== "team") ??
    null
  );
}

export function canDelegate(agent: OctopAgent | null): boolean {
  return Boolean(
    agent?.state === "running" &&
      agent.kind === "team" &&
      (agent.member_ids?.length ?? 0) > 0,
  );
}

/** The home conversation is the user/host transcript, not the execution log. */
export function visibleConversationMessages(
  messages: ChatMessage[],
  hostAgentId: string | null,
): ChatMessage[] {
  return messages.filter((message) => {
    if (message.role === "user") return true;
    if (message.role !== "assistant") return false;
    if (message.toolData || message.hitlData || message.type === "tool") return false;
    if (message.speakerAgentId && message.speakerAgentId !== hostAgentId) {
      return false;
    }
    return Boolean(message.content.trim());
  });
}

/** Prevent script URLs, embedded credentials and accidental public-site embeds. */
export function resolvePrivatePlatformUrl(
  rawUrl: string,
  dashboardHostname: string,
  dashboardProtocol = "http:",
): string | null {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.hostname !== dashboardHostname) return null;
    // Browsers block a plain HTTP iframe under a private HTTPS dashboard.
    if (dashboardProtocol === "https:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
