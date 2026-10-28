import { request } from "../request";
import type { ACPConfig, ACPModelOption, ACPRunnerConfig } from "../types/acp";

function agentPath(agentId: string, suffix = ""): string {
  return `/agents/${encodeURIComponent(agentId)}/acp${suffix}`;
}

function optionalAgentHeaders(
  agentId?: string | null,
): HeadersInit | undefined {
  const id = (agentId ?? "").trim();
  if (!id) return undefined;
  return { "X-Octop-Agent-Id": id };
}

export const acpApi = {
  /** Global runner definitions (shared by all agents for the current user). */
  getGlobalRunners: (agentId?: string | null) =>
    request<{ runners: Record<string, ACPRunnerConfig> }>("/acp", {
      headers: optionalAgentHeaders(agentId),
    }),

  updateGlobalRunners: (
    runners: Record<string, ACPRunnerConfig>,
    agentId?: string | null,
  ) =>
    request<{ runners: Record<string, ACPRunnerConfig> }>("/acp", {
      method: "PUT",
      body: JSON.stringify({ runners }),
      headers: optionalAgentHeaders(agentId),
    }),

  getRunner: (runnerName: string) =>
    request<ACPRunnerConfig>(`/acp/${encodeURIComponent(runnerName)}`),

  updateRunner: (runnerName: string, body: ACPRunnerConfig) =>
    request<ACPRunnerConfig>(`/acp/${encodeURIComponent(runnerName)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteRunner: (runnerName: string) =>
    request<void>(`/acp/${encodeURIComponent(runnerName)}`, {
      method: "DELETE",
    }),

  /** Combined view: global runners + per-agent tool toggle. */
  getConfig: (agentId: string) => request<ACPConfig>(agentPath(agentId)),

  getRunnerModels: (agentId: string, runnerName: string) =>
    request<{ models: ACPModelOption[] }>(
      `${agentPath(agentId)}/${encodeURIComponent(runnerName)}/models`,
    ),

  installOpenCode: () =>
    request<{ command: string; runner: ACPRunnerConfig }>(
      "/acp/opencode/install",
      { method: "POST" },
    ),

  updateConfig: (
    agentId: string,
    body: Pick<ACPConfig, "tool_enabled"> &
      Partial<Pick<ACPConfig, "default_model" | "runners">>,
  ) =>
    request<ACPConfig>(agentPath(agentId), {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  updateToolEnabled: (agentId: string, tool_enabled: boolean) =>
    request<{ tool_enabled: boolean }>(`${agentPath(agentId)}/tool`, {
      method: "PUT",
      body: JSON.stringify({ tool_enabled }),
    }),

  /** @deprecated Prefer acpApi.updateRunner */
  updateAgentRunner: (
    agentId: string,
    runnerName: string,
    body: ACPRunnerConfig,
  ) =>
    request<ACPRunnerConfig>(
      `${agentPath(agentId)}/${encodeURIComponent(runnerName)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  /** @deprecated Prefer acpApi.deleteRunner */
  deleteAgentRunner: (agentId: string, runnerName: string) =>
    request<void>(`${agentPath(agentId)}/${encodeURIComponent(runnerName)}`, {
      method: "DELETE",
    }),
};
