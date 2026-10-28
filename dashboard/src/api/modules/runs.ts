import { request } from "../request";

export type RunStatus =
  | "created"
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "interrupted"
  | "unknown_external_effect";

export interface Run {
  run_id: string;
  project_id: string | null;
  agent_id: string;
  agent_version_id: string | null;
  thread_id: string | null;
  project_context_snapshot: {
    project_id: string;
    instructions_revision: number;
    instructions: string;
    knowledge_base_ids: string[];
  } | null;
  source_file_revisions: {
    file_id: string;
    revision_id: string;
    thread_id: string;
    content_hash: string;
    media_type: string;
    byte_size: number;
  }[];
  capability_scope_snapshot: CapabilityScopeSnapshot[];
  status: RunStatus;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface CapabilityScopeSnapshot {
  registration_id: string;
  app_key: string;
  grant_id: string;
  expires_at: number | null;
  read_scopes: string[];
  write_scopes: string[];
}

export interface RunStep {
  step_id: string;
  run_id: string;
  kind: string;
  executor: string;
  status: string;
  attempt: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface TeamRunChild {
  run_id: string;
  agent_id: string;
  status: RunStatus;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface RunEvent {
  event_id: string;
  run_id: string;
  step_id: string | null;
  sequence: number;
  type: string;
  payload?: { error_code?: string };
  created_at: number;
}

export interface RunArtifact {
  artifact_id: string;
  run_id: string | null;
  project_id: string | null;
  agent_id: string;
  thread_id: string;
  file_id: string;
  revision_id: string;
  display_name: string;
  content_hash: string;
  media_type: string;
  byte_size: number;
  origin_kind: string;
  created_at: number;
  content_url: string;
}

export interface RunEffect {
  effect_id: string;
  scope: string;
  status: "requested" | "succeeded" | "failed" | "unknown";
}

export interface RunListOptions {
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

export const runsApi = {
  list: (projectId?: string, options: RunListOptions = {}) => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (options.status) params.set("status", options.status);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined)
      params.set("offset", String(options.offset));
    const query = params.toString();
    return request<Run[]>(`/runs${query ? `?${query}` : ""}`);
  },
  get: (runId: string) => request<Run>(`/runs/${encodeURIComponent(runId)}`),
  children: (runId: string) =>
    request<TeamRunChild[]>(`/runs/${encodeURIComponent(runId)}/children`),
  cancel: (runId: string) =>
    request<Run>(`/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    }),
  start: (runId: string) =>
    request<Run>(`/runs/${encodeURIComponent(runId)}/start`, {
      method: "POST",
    }),
  steps: (runId: string) =>
    request<RunStep[]>(`/runs/${encodeURIComponent(runId)}/steps`),
  events: (runId: string) =>
    request<RunEvent[]>(`/runs/${encodeURIComponent(runId)}/events`),
  artifacts: (runId: string) =>
    request<RunArtifact[]>(`/runs/${encodeURIComponent(runId)}/artifacts`),
  projectArtifacts: (projectId: string, limit = 50, offset = 0) =>
    request<RunArtifact[]>(
      `/runs/projects/${encodeURIComponent(
        projectId,
      )}/artifacts?limit=${limit}&offset=${offset}`,
    ),
  effects: (runId: string) =>
    request<RunEffect[]>(`/runs/${encodeURIComponent(runId)}/effects`),
  attachArtifact: (runId: string, fileId: string, revisionId: string) =>
    request<RunArtifact>(`/runs/${encodeURIComponent(runId)}/artifacts`, {
      method: "POST",
      body: JSON.stringify({ file_id: fileId, revision_id: revisionId }),
    }),
};
