import { describe, expect, it } from "vitest";
import type { AssistantTurnSplit } from "../pages/Chat/utils/messageContent";
import { collectTurnWebSearchSources } from "./collectTurnWebSearchSources";

describe("collectTurnWebSearchSources", () => {
  it("collects persisted search results once per URL across tool calls", () => {
    const split = {
      tools: [
        {
          id: "tool-1",
          role: "tool",
          content: "",
          timestamp: 1,
          toolData: {
            name: "tavily_search",
            output: JSON.stringify({
              results: [
                { title: "First title", url: "https://example.com/a" },
                { title: "Other", url: "https://example.com/b" },
              ],
            }),
          },
        },
        {
          id: "tool-2",
          role: "tool",
          content: "",
          timestamp: 2,
          toolData: {
            name: "google_search",
            output: JSON.stringify([
              { title: "Duplicate", link: "https://example.com/a" },
            ]),
          },
        },
      ],
      thinkings: [],
      processSteps: [],
      answerMessage: null,
    } as AssistantTurnSplit;

    expect(collectTurnWebSearchSources(split).map((source) => source.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});
