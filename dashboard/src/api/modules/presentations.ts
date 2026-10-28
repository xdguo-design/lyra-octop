import { getAuthToken, request, requestBlob } from "../request";
import { getApiUrl } from "../config";

export interface PresentationSlide {
  slide_id: string;
  title: string;
  body: string;
  notes: string;
  svg: string | null;
}

export type PresentationStatus =
  | "idle"
  | "outline"
  | "generating"
  | "revising"
  | "exporting"
  | "failed";

export type PresentationStyle =
  | "paper"
  | "dark"
  | "minimal"
  | "business"
  | "tech"
  | "kids";

export interface PresentationDeck {
  deck_id: string;
  agent_id: string;
  owner_user_id: number;
  title: string;
  brief: string;
  audience: string;
  style: PresentationStyle;
  page_count: number;
  slides: PresentationSlide[];
  revision: number;
  status: PresentationStatus;
  error: string | null;
  export_path: string | null;
  updated_at: number;
}

export interface PresentationCreate {
  title: string;
  brief: string;
  audience: string;
  style: PresentationDeck["style"];
  page_count: number;
}

export type PresentationSave = Pick<
  PresentationDeck,
  | "revision"
  | "title"
  | "brief"
  | "audience"
  | "style"
  | "slides"
  | "page_count"
>;

export interface PresentationJob {
  revision: number;
  action: "outline" | "generate" | "compose" | "revise" | "export";
  page_id?: string;
  instruction?: string;
}

export interface PresentationRuntime {
  installed: boolean;
  version: string;
  commit: string;
}

export interface PresentationChatTurn {
  role: "user" | "assistant";
  text: string;
  action: string | null;
  at: number;
}

export interface PresentationChatLog {
  messages: PresentationChatTurn[];
}

export interface PresentationChatResponse {
  reply: string;
  action: string;
  deck: PresentationDeck | null;
}

const root = (agentId: string) =>
  `/agents/${encodeURIComponent(agentId)}/presentations`;
const path = (agentId: string, deckId: string) =>
  `${root(agentId)}/${encodeURIComponent(deckId)}`;

export const presentationsApi = {
  runtime: (agentId: string) =>
    request<PresentationRuntime>(`${root(agentId)}/runtime`),
  list: (agentId: string) => request<PresentationDeck[]>(root(agentId)),
  get: (agentId: string, deckId: string) =>
    request<PresentationDeck>(path(agentId, deckId)),
  create: (agentId: string, body: PresentationCreate) =>
    request<PresentationDeck>(root(agentId), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  save: (agentId: string, deckId: string, body: PresentationSave) =>
    request<PresentationDeck>(path(agentId, deckId), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  job: (agentId: string, deckId: string, body: PresentationJob) =>
    request<PresentationDeck>(`${path(agentId, deckId)}/jobs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  chat: (agentId: string, body: { deck_id?: string; message: string }) =>
    request<PresentationChatResponse>(`${root(agentId)}/chat`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  chatStream: async (
    agentId: string,
    body: { deck_id?: string; message: string },
    onDelta?: (text: string) => void,
  ): Promise<PresentationChatResponse> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      getApiUrl(
        `/agents/${encodeURIComponent(agentId)}/presentations/chat/stream`,
      ),
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        detail.slice(0, 300) || `chat stream failed (${res.status})`,
      );
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let outcome: PresentationChatResponse = {
      reply: "",
      action: "none",
      deck: null,
    };
    let settled = false;
    const handle = (frame: string) => {
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) return;
      const payload = JSON.parse(data) as {
        text?: string;
        reply?: string;
        action?: string;
        deck?: PresentationDeck | null;
      };
      if (event === "delta" && payload.text) onDelta?.(payload.text);
      if (event === "result") {
        settled = true;
        outcome = {
          reply: payload.reply ?? "",
          action: payload.action ?? "none",
          deck: payload.deck ?? null,
        };
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(frame.replace(/\r/g, ""));
      }
    }
    if (buffer.trim()) handle(buffer);
    if (!settled) throw new Error("chat stream ended without a result");
    return outcome;
  },
  chatLog: (agentId: string, deckId?: string) =>
    request<PresentationChatLog>(
      deckId ? `${path(agentId, deckId)}/chat` : `${root(agentId)}/chat`,
    ),
  download: (agentId: string, deckId: string) =>
    requestBlob(`${path(agentId, deckId)}/download`),
};
