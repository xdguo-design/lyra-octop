import { request } from "../request";

export interface CreationFolder {
  folder_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface CreationItem {
  item_id: string;
  kind: "platform" | "service" | "applet";
  name: string;
  description: string;
  url: string | null;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
  thumbnail_url: string | null;
}

export interface CreationCardMeta {
  name: string | null;
  description: string | null;
  category: "platform" | "applet" | "service" | "repository" | null;
}

export interface CreationsIndex {
  folders: CreationFolder[];
  items: CreationItem[];
  card_folders: Record<string, string>;
  card_meta: Record<string, CreationCardMeta>;
}

export interface CreationItemInput {
  kind: CreationItem["kind"];
  name: string;
  description: string;
  url: string | null;
  folder_id: string | null;
}

export interface ProjectLaunchStatus {
  status: "stopped" | "starting" | "running" | "failed";
  url: string | null;
  logs: string | null;
  thumbnail_url: string | null;
}

export const creationsApi = {
  list: () => request<CreationsIndex>("/creations"),
  launchStatus: (itemId: string) =>
    request<ProjectLaunchStatus>(
      `/creations/items/${encodeURIComponent(itemId)}/launch`,
    ),
  startProject: (itemId: string) =>
    request<ProjectLaunchStatus>(
      `/creations/items/${encodeURIComponent(itemId)}/launch`,
      { method: "POST" },
    ),
  stopProject: (itemId: string) =>
    request<ProjectLaunchStatus>(
      `/creations/items/${encodeURIComponent(itemId)}/launch`,
      { method: "DELETE" },
    ),
  createFolder: (name: string) =>
    request<CreationFolder>("/creations/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameFolder: (folderId: string, name: string) =>
    request<CreationFolder>(
      `/creations/folders/${encodeURIComponent(folderId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    ),
  deleteFolder: (folderId: string) =>
    request<void>(`/creations/folders/${encodeURIComponent(folderId)}`, {
      method: "DELETE",
    }),
  createItem: (body: CreationItemInput) =>
    request<CreationItem>("/creations/items", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateItem: (itemId: string, body: CreationItemInput) =>
    request<CreationItem>(`/creations/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteItem: (itemId: string) =>
    request<void>(`/creations/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    }),
  setCardFolder: (
    cardType: "agent" | "app",
    cardId: string,
    folderId: string | null,
  ) =>
    request<{ folder_id: string | null }>(
      `/creations/cards/${cardType}/${encodeURIComponent(cardId)}/folder`,
      { method: "PUT", body: JSON.stringify({ folder_id: folderId }) },
    ),
  setCardMeta: (
    cardType: "agent" | "app",
    cardId: string,
    meta: {
      name: string | null;
      description: string | null;
      category: "platform" | "applet" | "service" | "repository" | null;
    },
  ) =>
    request<CreationCardMeta>(
      `/creations/cards/${cardType}/${encodeURIComponent(cardId)}/meta`,
      { method: "PUT", body: JSON.stringify(meta) },
    ),
};
