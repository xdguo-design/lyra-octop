import type { OctopAgent } from "../../context/AgentContext";
import type { ChatMessage } from "../Chat/hooks/sseHelpers";

/** A running team host is the only guaranteed delegation-capable entry point. */
export function selectPrimaryAgent(
  agents: OctopAgent[],
  preferredAgentId?: string | null,
): OctopAgent | null {
  const running = agents.filter((a) => a.state === "running" && !a.bridge);
  const teams = running.filter((a) => a.kind === "team");
  const preferred = running.find((a) => a.agent_id === preferredAgentId);
  // When team hosts exist, never silently downgrade the designated coordinator
  // to a worker: only a team may be selected as the primary entry point.
  if (preferred && (preferred.kind === "team" || teams.length === 0)) {
    return preferred;
  }
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

/** Keep the host transcript and execution events; omit peer chatter and hidden reasoning. */
export function visibleConversationMessages(
  messages: ChatMessage[],
  hostAgentId: string | null,
): ChatMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "user") return [message];
    if (message.role !== "assistant" && message.role !== "tool") return [];
    if (message.speakerAgentId && message.speakerAgentId !== hostAgentId) {
      return [];
    }
    if (message.type === "reasoning" || message.hitlData) return [];
    const textBlocks = message.contentBlocks?.filter(
      (block) => block.type === "text",
    );
    const visibleMessage = message.contentBlocks?.some(
      (block) => block.type === "thinking",
    )
      ? {
          ...message,
          content: textBlocks?.map((block) => block.content).join("") ?? "",
          contentBlocks: textBlocks,
        }
      : message;
    return visibleMessage.content.trim() ||
      visibleMessage.contentBlocks?.length ||
      visibleMessage.toolData
      ? [visibleMessage]
      : [];
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
    const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
    if (
      url.hostname !== dashboardHostname &&
      !(loopbackHosts.has(url.hostname) && loopbackHosts.has(dashboardHostname))
    )
      return null;
    // Browsers block a plain HTTP iframe under a private HTTPS dashboard.
    if (dashboardProtocol === "https:" && url.protocol !== "https:")
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function supportsLocalProjectPreview(
  hostname: string,
  protocol: string,
): boolean {
  return (
    protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  );
}
