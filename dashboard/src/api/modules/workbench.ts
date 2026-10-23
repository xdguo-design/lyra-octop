import { request } from "../request";

export interface WorkbenchProject {
  project_id: string;
  name: string;
  icon: string;
  parent_id: string | null;
  external_url?: string | null;
  code_enabled: boolean;
  knowledge_base_ids: string[];
  created_at: number;
  updated_at: number;
}

export interface WorkbenchFolder {
  folder_id: string;
  project_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface WorkbenchAssignment {
  thread_id: string;
  project_id: string | null;
  folder_id: string | null;
}

export interface WorkbenchIndex {
  projects: WorkbenchProject[];
  folders: WorkbenchFolder[];
  recycled_folders: WorkbenchFolder[];
  assignments: WorkbenchAssignment[];
}

export interface CodeEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
}

export interface ProjectShare {
  share_id: string;
  project_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface CreatedProjectShare extends ProjectShare {
  token: string;
}

export interface SharedProjectPayload {
  project: Pick<WorkbenchProject, "project_id" | "name" | "icon" | "parent_id">;
  projects: Array<
    Pick<WorkbenchProject, "project_id" | "name" | "icon" | "parent_id">
  >;
  folders: Array<Pick<WorkbenchFolder, "folder_id" | "project_id" | "name">>;
  threads: Array<
    Pick<WorkbenchAssignment, "thread_id"> & {
      project_id: string;
      folder_id: string | null;
      title: string | null;
    }
  >;
  expires_at: number;
  timezone: string;
}

export interface SharedThreadHistory {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    created_at: number;
  }>;
  has_more: boolean;
  next_offset: number;
  history_status: string;
}

export const workbenchApi = {
  get: () => request<WorkbenchIndex>("/workbench"),
  importLocalProjects: (
    projects: Array<{ name: string; thread_ids: string[] }>,
  ) =>
    request<void>("/workbench/import-local", {
      method: "POST",
      body: JSON.stringify({ projects }),
    }),
  createProject: (name: string, icon: string, parentId?: string | null) =>
    request<WorkbenchProject>("/workbench/projects", {
      method: "POST",
      body: JSON.stringify({ name, icon, parent_id: parentId ?? null }),
    }),
  importFromGithub: (ref: string) =>
    request<WorkbenchProject>("/workbench/projects/from-github", {
      method: "POST",
      body: JSON.stringify({ ref }),
    }),
  updateProject: (
    projectId: string,
    name: string,
    icon: string,
    parentId?: string | null,
  ) =>
    request<WorkbenchProject>(
      `/workbench/projects/${encodeURIComponent(projectId)}`,
      {
        method: "PUT",
        // parent_id 传 undefined=不改层级；显式 null=移回顶级。
        body: JSON.stringify(
          parentId === undefined
            ? { name, icon }
            : { name, icon, parent_id: parentId },
        ),
      },
    ),
  setProjectKnowledgeBases: (projectId: string, knowledgeBaseIds: string[]) =>
    request<string[]>(
      `/workbench/projects/${encodeURIComponent(projectId)}/knowledge-bases`,
      {
        method: "PUT",
        body: JSON.stringify({ knowledge_base_ids: knowledgeBaseIds }),
      },
    ),
  deleteProject: (projectId: string) =>
    request<void>(`/workbench/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }),
  createFolder: (projectId: string, name: string) =>
    request<WorkbenchFolder>(
      `/workbench/projects/${encodeURIComponent(projectId)}/folders`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
    ),
  renameFolder: (folderId: string, name: string) =>
    request<WorkbenchFolder>(
      `/workbench/folders/${encodeURIComponent(folderId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    ),
  deleteFolder: (folderId: string) =>
    request<void>(`/workbench/folders/${encodeURIComponent(folderId)}`, {
      method: "DELETE",
    }),
  restoreFolder: (folderId: string) =>
    request<void>(
      `/workbench/folders/${encodeURIComponent(folderId)}/restore`,
      { method: "POST" },
    ),
  assignThread: (
    threadId: string,
    projectId: string | null,
    folderId: string | null = null,
  ) =>
    request<WorkbenchAssignment>(
      `/workbench/threads/${encodeURIComponent(threadId)}/assignment`,
      {
        method: "PUT",
        body: JSON.stringify({ project_id: projectId, folder_id: folderId }),
      },
    ),
  listCode: (projectId: string, path = ".") =>
    request<{ path: string; entries: CodeEntry[] }>(
      `/workbench/projects/${encodeURIComponent(
        projectId,
      )}/code?path=${encodeURIComponent(path)}`,
    ),
  readCodeFile: (projectId: string, path: string) =>
    request<{ path: string; content: string; size: number }>(
      `/workbench/projects/${encodeURIComponent(
        projectId,
      )}/code/file?path=${encodeURIComponent(path)}`,
    ),
  listShares: (projectId: string) =>
    request<ProjectShare[]>(
      `/workbench/projects/${encodeURIComponent(projectId)}/shares`,
    ),
  createShare: (projectId: string, expiresInSeconds: number) =>
    request<CreatedProjectShare>(
      `/workbench/projects/${encodeURIComponent(projectId)}/shares`,
      {
        method: "POST",
        body: JSON.stringify({ expires_in_seconds: expiresInSeconds }),
      },
    ),
  revokeShare: (projectId: string, shareId: string) =>
    request<void>(
      `/workbench/projects/${encodeURIComponent(
        projectId,
      )}/shares/${encodeURIComponent(shareId)}`,
      { method: "DELETE" },
    ),
  getSharedProject: (token: string) =>
    request<SharedProjectPayload>(
      `/workbench-shares/${encodeURIComponent(token)}`,
    ),
  getSharedThreadHistory: (
    token: string,
    threadId: string,
    limit = 100,
    offset = 0,
  ) =>
    request<SharedThreadHistory>(
      `/workbench-shares/${encodeURIComponent(
        token,
      )}/threads/${encodeURIComponent(
        threadId,
      )}?limit=${limit}&offset=${offset}`,
    ),
};
