import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.stubGlobal("fetch", fetchMock);

import { ehrApi, resolveRagBaseUrl, setRagBaseUrl } from "@/api/modules/ehr";

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.removeItem("ehr-rag-base-url");
});

afterEach(() => {
  window.localStorage.removeItem("ehr-rag-base-url");
});

describe("resolveRagBaseUrl", () => {
  it("falls back to same-host port 8600", () => {
    // jsdom 默认 host 为 localhost
    expect(resolveRagBaseUrl()).toMatch(/^http:\/\/[^:]+:8600$/);
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
  it("posts search with query and type filter", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ query: "q", total: 0, results: [] }),
    });
    await ehrApi.search("阿司匹林", { type: "drug", top_k: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/search");
    expect(JSON.parse(init.body)).toEqual({
      query: "阿司匹林",
      type: "drug",
      top_k: 5,
    });
  });

  it("throws with status on non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    await expect(ehrApi.health()).rejects.toThrow(/502/);
  });

  it("runSkill encodes the skill name", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
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
      json: async () => ({ id: "drug:1", name: "x", neighbors: [] }),
    });
    await ehrApi.graphNode("drug:720011849");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/graph/node/drug%3A720011849",
    );
  });
});
