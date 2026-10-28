import { request } from "../request";

export type ChatFileReadStatus =
  | "stored"
  | "processing"
  | "ready"
  | "partial"
  | "needs_ocr"
  | "unsupported"
  | "failed";

/** A parser-derived location pinned to a content hash and immutable revision. */
export interface ChatFileSourceSpan {
  file_id: string;
  revision_id: string;
  parser_version: number;
  content_hash: string;
  ordinal: number;
  locator: Record<string, unknown>;
}

/** One parsed, locator-backed file segment (never a host path). */
export interface ChatFileSegment {
  ordinal: number;
  locator_json: string;
  text: string;
  char_count: number;
  source_span: ChatFileSourceSpan | null;
}

export interface ChatFileSummary {
  file_id: string;
  display_name: string;
  media_type: string;
  byte_size: number;
  read_status: ChatFileReadStatus;
  current_revision_id: string | null;
  origin_kind: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChatFileRevisionSummary {
  revision_id: string;
  parent_revision_id: string | null;
  origin_kind: string;
  read_status: ChatFileReadStatus;
  byte_size: number;
  created_at: number;
  access_url?: string;
}

export interface ChatFileDetail extends ChatFileSummary {
  coverage: Record<string, unknown>;
  revisions: ChatFileRevisionSummary[];
  access_url?: string | null;
}

export interface ChatFileSegmentsPage {
  file_id: string;
  revision_id: string;
  read_status: ChatFileReadStatus;
  segments: ChatFileSegment[];
  next_offset: number | null;
}

export interface ChatFileSearchResult {
  file_id: string;
  revision_id: string;
  query: string;
  matches: ChatFileSegment[];
}

export interface TextArtifactInput {
  filename: string;
  content: string;
}

export interface TextArtifactRevisionInput {
  thread_id: string;
  base_revision_id: string;
  content: string;
}

export interface TextArtifactContent {
  file_id: string;
  revision_id: string;
  content: string;
}

/** Create a conversation-owned TXT, MD or CSV file. */
export async function createThreadTextFile(
  agentId: string,
  threadId: string,
  input: TextArtifactInput,
): Promise<ChatFileDetail> {
  return request<ChatFileDetail>(
    `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(
      threadId,
    )}/files`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Append a text revision only if the supplied base is still current. */
export async function createTextFileRevision(
  agentId: string,
  fileId: string,
  input: TextArtifactRevisionInput,
): Promise<ChatFileDetail> {
  return request<ChatFileDetail>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(
      fileId,
    )}/revisions`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Read one exact text revision after the server checks file/thread ownership. */
export async function readTextFileRevision(
  agentId: string,
  fileId: string,
  revisionId: string,
  threadId: string,
): Promise<TextArtifactContent> {
  const query = new URLSearchParams({ thread_id: threadId });
  return request<TextArtifactContent>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(
      fileId,
    )}/revisions/${encodeURIComponent(revisionId)}/text?${query.toString()}`,
  );
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
  createThreadTextFile,
  createTextFileRevision,
  readTextFileRevision,
  listThreadFiles,
  getFile,
  getFileSegments,
  searchFile,
  deleteChatFileDraft,
};
