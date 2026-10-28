import { request } from "../request";

/**
 * EHR RAG 服务 API 客户端。
 *
 * 服务地址解析优先级：
 * 1. 页面内设置（localStorage: ehr-rag-base-url）
 * 2. 构建期环境变量 VITE_EHR_RAG_URL
 * 3. 运行时推导：与平台同主机名的 8600 端口（http://<host>:8600）
 */
const STORAGE_KEY = "ehr-rag-base-url";

export function resolveRagBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && stored.trim()) return stored.trim().replace(/\/+$/, "");
  const fromEnv = import.meta.env.VITE_EHR_RAG_URL as string | undefined;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");
  return "/ehr-rag";
}

export function setRagBaseUrl(url: string): void {
  window.localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/+$/, ""));
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const base = resolveRagBaseUrl();
  if (base.startsWith("/")) return request<T>(`${base}${path}`, init);
  const resp = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`EHR 服务 ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

// ---------------------------------------------------------------- 类型
export interface EhrDocType {
  type: string;
  label: string;
}

export const EHR_DOC_TYPES: EhrDocType[] = [
  { type: "drug", label: "药品" },
  { type: "clinic_item", label: "诊疗项目" },
  { type: "diagnosis", label: "诊断" },
  { type: "knowledge", label: "知识库" },
  { type: "frequency", label: "频次" },
  { type: "usage", label: "用法" },
  { type: "doc", label: "文档" },
  { type: "code", label: "代码" },
  { type: "skill", label: "技能" },
];

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  score: number;
  vector_score: number;
  keyword_score: number;
  snippet: string;
  meta: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
}

export interface QaSource {
  id: string;
  type: string;
  title: string;
  score: number;
  snippet: string;
  meta: Record<string, unknown>;
}

export interface QaResponse {
  question: string;
  answer: string;
  degraded: boolean;
  sources: QaSource[];
}

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  props: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  rel: string;
}

export interface GraphNeighbor {
  rel: string;
  direction: "out" | "in";
  node: GraphNode;
  props: Record<string, unknown>;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  node_types: Record<string, number>;
  top_relations: Record<string, number>;
}

export interface EhrSkill {
  name: string;
  title: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------- API
export const ehrApi = {
  async health(): Promise<{ ok: boolean; docs: number; graph: boolean }> {
    return call("/api/health");
  },

  async stats(): Promise<{
    docs: number;
    doc_types: Record<string, number>;
    graph?: GraphStats;
    build?: Record<string, unknown>;
  }> {
    return call("/api/stats");
  },

  async search(
    query: string,
    opts: { type?: string; types?: string[]; top_k?: number } = {},
  ): Promise<SearchResponse> {
    return call("/api/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        type: opts.type || undefined,
        filters: opts.types?.length ? { type: opts.types } : undefined,
        top_k: opts.top_k || 10,
      }),
    });
  },

  async qa(question: string, topK = 6): Promise<QaResponse> {
    return call("/api/qa", {
      method: "POST",
      body: JSON.stringify({ question, top_k: topK }),
    });
  },

  async graphSearch(
    name: string,
    type?: string,
  ): Promise<{ nodes: GraphNode[] }> {
    return call("/api/graph/search", {
      method: "POST",
      body: JSON.stringify({ name, type: type || undefined, limit: 20 }),
    });
  },

  async graphNode(
    id: string,
  ): Promise<GraphNode & { neighbors: GraphNeighbor[] }> {
    return call(`/api/graph/node/${encodeURIComponent(id)}`);
  },

  async graphSubgraph(
    id: string,
    depth = 2,
  ): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }> {
    return call(`/api/graph/subgraph/${encodeURIComponent(id)}?depth=${depth}`);
  },

  async graphPath(source: string, target: string): Promise<{ path: unknown }> {
    return call("/api/graph/path", {
      method: "POST",
      body: JSON.stringify({ source, target }),
    });
  },

  async skills(): Promise<{ skills: EhrSkill[] }> {
    return call("/api/skills");
  },

  async runSkill(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return call(`/api/skills/${encodeURIComponent(name)}/run`, {
      method: "POST",
      body: JSON.stringify({ args }),
    });
  },
};

export const publicEhrApi = {
  async health(): Promise<{ ok: boolean }> {
    return request("/public/ehr/health");
  },

  async search(query: string, topK = 12): Promise<SearchResponse> {
    return request("/public/ehr/search", {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK }),
    });
  },
};
