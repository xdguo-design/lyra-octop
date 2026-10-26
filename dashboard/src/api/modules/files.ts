import { request } from "../request";

/** One parsed, locator-backed file segment (never a host path). */
export interface ChatFileSegment {
  ordinal: number;
  locator_json: string;
  text: string;
  char_count: number;
}

export interface ChatFileSummary {
  file_id: string;
  display_name: string;
  media_type: string;
  byte_size: number;
  read_status: string;
  current_revision_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChatFileRevisionSummary {
  revision_id: string;
  parent_revision_id: string | null;
  origin_kind: string;
  read_status: string;
  byte_size: number;
  created_at: number;
}

export interface ChatFileDetail extends ChatFileSummary {
  coverage: Record<string, unknown>;
  revisions: ChatFileRevisionSummary[];
}

export interface ChatFileSegmentsPage {
  file_id: string;
  revision_id: string;
  read_status: string;
  segments: ChatFileSegment[];
  next_offset: number | null;
}

export interface ChatFileSearchResult {
  file_id: string;
  revision_id: string;
  query: string;
  matches: ChatFileSegment[];
}

/** Soft-delete an owned attachment draft that has not been bound to a thread. */
export async function deleteChatFileDraft(
  agentId: string,
  fileId: string,
): Promise<void> {
  return request<void>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(
      fileId,
    )}/draft`,
    { method: "DELETE" },
  );
}

/** Files bound to one conversation thread (metadata only). */
export async function listThreadFiles(
  agentId: string,
  threadId: string,
): Promise<ChatFileSummary[]> {
  return request<ChatFileSummary[]>(
    `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(
      threadId,
    )}/files`,
  );
}

/** File metadata, current coverage and revision history. */
export async function getFile(
  agentId: string,
  fileId: string,
): Promise<ChatFileDetail> {
  return request<ChatFileDetail>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(
      fileId,
    )}`,
  );
}

/** Bounded page of extracted segments (defaults to the current revision). */
export async function getFileSegments(
  agentId: string,
  fileId: string,
  options: { revisionId?: string; limit?: number; offset?: number } = {},
): Promise<ChatFileSegmentsPage> {
  const params = new URLSearchParams();
  if (options.revisionId) params.set("revision_id", options.revisionId);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined)
    params.set("offset", String(options.offset));
  const query = params.toString();
  return request<ChatFileSegmentsPage>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(
      fileId,
    )}/segments${query ? `?${query}` : ""}`,
  );
}

/** Bounded keyword search over one revision's segments. */
export async function searchFile(
  agentId: string,
  fileId: string,
  query: string,
  options: { revisionId?: string; limit?: number } = {},
): Promise<ChatFileSearchResult> {
  return request<ChatFileSearchResult>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(
      fileId,
    )}/search`,
    {
      method: "POST",
      body: JSON.stringify({
        query,
        revision_id: options.revisionId,
        limit: options.limit,
      }),
    },
  );
}

export const filesApi = {
  listThreadFiles,
  getFile,
  getFileSegments,
  searchFile,
  deleteChatFileDraft,
};
