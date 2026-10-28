import type { AssistantTurnSplit } from "../pages/Chat/utils/messageContent";
import {
  parseWebSearchSources,
  type WebSearchSource,
} from "./parseWebSearchSources";

/** Collect unique sources from persisted search-tool results in one assistant turn. */
export function collectTurnWebSearchSources(
  split: AssistantTurnSplit,
): WebSearchSource[] {
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();
  for (const message of split?.tools ?? []) {
    const name = message.toolData?.name ?? "";
    const parsed = parseWebSearchSources(message.toolData?.output, name);
    for (const source of parsed) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources;
}
