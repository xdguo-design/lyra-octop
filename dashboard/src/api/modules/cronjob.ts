import { request } from "../request";
import type {
  OctopCronRow,
  OctopCronCreateBody,
  OctopCronPatchBody,
} from "../types";

export interface OctopCronSettings {
  timezone: string;
}

export interface CronTaskExamples {
  zh?: string[];
  en?: string[];
}

export interface OctopCronRun {
  run_id: string;
  cron_id: string;
  agent_id: string;
  trigger_kind: "manual" | "scheduled" | "mail";
  status: "running" | "ok" | "error" | "cancelled" | "interrupted";
  started_at: number;
  finished_at: number | null;
  error: string | null;
}

export const octopCronApi = {
  settings: () => request<OctopCronSettings>("/cron/settings"),

  list: (agentId: string) => request<OctopCronRow[]>(`/agents/${agentId}/cron`),

  create: (agentId: string, body: OctopCronCreateBody) =>
    request<OctopCronRow>(`/agents/${agentId}/cron`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  get: (agentId: string, cronId: string) =>
    request<OctopCronRow>(`/agents/${agentId}/cron/${cronId}`),

  patch: (agentId: string, cronId: string, body: OctopCronPatchBody) =>
    request<OctopCronRow>(`/agents/${agentId}/cron/${cronId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  delete: (agentId: string, cronId: string) =>
    request<void>(`/agents/${agentId}/cron/${cronId}`, { method: "DELETE" }),

  runNow: (agentId: string, cronId: string) =>
    request<{ run_id: string; status: "running" }>(
      `/agents/${agentId}/cron/${cronId}/run-now`,
      {
        method: "POST",
      },
    ),

  runs: (agentId: string, cronId: string, limit = 20, offset = 0) =>
    request<OctopCronRun[]>(
      `/agents/${agentId}/cron/${cronId}/runs?limit=${limit}&offset=${offset}`,
    ),

  cancelRun: (agentId: string, cronId: string, runId: string) =>
    request<{ cancelled: boolean }>(
      `/agents/${agentId}/cron/${cronId}/runs/${runId}/cancel`,
      { method: "POST" },
    ),
};
