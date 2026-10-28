import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.stubGlobal("fetch", fetchMock);
vi.mock("@/api/config", () => ({
  getApiUrl: (path: string) => `/api${path}`,
}));

import {
  ehrApi,
  publicEhrApi,
  resolveRagBaseUrl,
  setRagBaseUrl,
} from "@/api/modules/ehr";

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.removeItem("ehr-rag-base-url");
  window.localStorage.removeItem("auth_token");
});

afterEach(() => {
  window.localStorage.removeItem("ehr-rag-base-url");
});

describe("resolveRagBaseUrl", () => {
  it("uses the authenticated Octop proxy by default", () => {
    expect(resolveRagBaseUrl()).toBe("/ehr-rag");
  });

  it("prefers the stored override", () => {
    window.localStorage.setItem(
      "ehr-rag-base-url",
      "http://example.test:9999/",
    );
    expect(resolveRagBaseUrl()).toBe("http://example.test:9999");
  });

  it("setRagBaseUrl normalizes trailing slashes", () => {
    setRagBaseUrl(" http://example.test:8600/// ");
    expect(resolveRagBaseUrl()).toBe("http://example.test:8600");
  });
});

describe("ehrApi", () => {
  it("uses the isolated anonymous endpoint for public search", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ query: "q", total: 0, results: [] }),
    });

    await publicEhrApi.search("阿司匹林", 12);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/public/ehr/search");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ query: "阿司匹林", top_k: 12 });
  });

  it("posts search with query and type filter", async () => {
    window.localStorage.setItem("auth_token", "session-token");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ query: "q", total: 0, results: [] }),
    });
    await ehrApi.search("阿司匹林", { type: "drug", top_k: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/ehr-rag/api/search");
    expect(init.headers.Authorization).toBe("Bearer session-token");
    expect(JSON.parse(init.body)).toEqual({
      query: "阿司匹林",
      type: "drug",
      top_k: 5,
    });
    window.localStorage.removeItem("auth_token");
  });

  it("throws with status on non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "bad gateway",
    });
    await expect(ehrApi.health()).rejects.toThrow(/502/);
  });

  it("runSkill encodes the skill name", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ total: 1, results: [] }),
    });
    await ehrApi.runSkill("ehr_drug", { flag: "高危药品" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/skills/ehr_drug/run");
    expect(JSON.parse(init.body)).toEqual({ args: { flag: "高危药品" } });
  });

  it("graphNode encodes the node id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: "drug:1", name: "x", neighbors: [] }),
    });
    await ehrApi.graphNode("drug:720011849");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/graph/node/drug%3A720011849",
    );
  });
});
