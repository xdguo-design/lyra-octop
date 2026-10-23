import { describe, expect, it } from "vitest";
import { parseWebSearchSources } from "./parseWebSearchSources";

describe("parseWebSearchSources", () => {
  it("normalizes Tavily results and Brave JSON output", () => {
    expect(
      parseWebSearchSources(
        { results: [{ title: "Tavily page", url: "https://example.com/t", content: "summary" }] },
        "tavily_search_results_json",
      ),
    ).toEqual([
      {
        title: "Tavily page",
        url: "https://example.com/t",
        snippet: "summary",
        provider: "Tavily",
      },
    ]);
    expect(
      parseWebSearchSources(
        JSON.stringify([{ title: "Brave page", link: "https://example.com/b", snippet: "text" }]),
        "brave_search",
      )[0],
    ).toMatchObject({ title: "Brave page", url: "https://example.com/b", provider: "Brave" });
    expect(
      parseWebSearchSources({ web: { results: [{ title: "Raw Brave", link: "https://example.com/raw" }] } }, "brave_search"),
    ).toHaveLength(1);
  });

  it("normalizes Google results and rejects unsafe or titleless URLs", () => {
    const sources = parseWebSearchSources(
      [
        { title: "Google page", link: "https://example.com/g", snippet: "summary" },
        { title: "Bad scheme", link: "javascript:alert(1)" },
        { title: "Credentials", link: "https://user:pass@example.com/" },
        { title: "   ", link: "https://example.com/empty" },
      ],
      "google_search",
    );
    expect(sources).toEqual([
      {
        title: "Google page",
        url: "https://example.com/g",
        snippet: "summary",
        provider: "Google",
      },
    ]);
  });

  it("accepts explicit Kimi markdown links but ignores ordinary text", () => {
    expect(
      parseWebSearchSources("Found [Kimi result](https://example.com/k) and no fabricated URL.", "kimi_search"),
    ).toEqual([
      { title: "Kimi result", url: "https://example.com/k", provider: "Kimi" },
    ]);
    expect(parseWebSearchSources("No links here", "kimi_search")).toEqual([]);
    expect(parseWebSearchSources("[not search](https://example.com)", "ordinary_tool")).toEqual([]);
  });
});
