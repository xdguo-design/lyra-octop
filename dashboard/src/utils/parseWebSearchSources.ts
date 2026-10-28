export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
  provider: string;
}

const PROVIDERS = ["tavily", "brave", "google", "kimi"] as const;
type Provider = (typeof PROVIDERS)[number];

function providerFromHint(hint: string): Provider | undefined {
  const lower = hint.toLowerCase();
  return PROVIDERS.find((provider) => lower.includes(provider));
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sourceFromRecord(
  value: unknown,
  provider: string,
): WebSearchSource | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const title =
    typeof row.title === "string"
      ? row.title.trim()
      : typeof row.name === "string"
      ? row.name.trim()
      : "";
  const url = safeUrl(row.url ?? row.link ?? row.href);
  if (!title || !url) return undefined;
  const snippet =
    typeof row.snippet === "string"
      ? row.snippet.trim()
      : typeof row.content === "string"
      ? row.content.trim()
      : typeof row.description === "string"
      ? row.description.trim()
      : "";
  return { title, url, ...(snippet ? { snippet } : {}), provider };
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const row = asRecord(payload);
  if (!row) return [];
  if (Array.isArray(row.results)) return row.results;
  const web = asRecord(row.web);
  if (web && Array.isArray(web.results)) return web.results;
  const data = asRecord(row.data);
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function parseExplicitMarkdownLinks(
  text: string,
  provider: string,
): WebSearchSource[] {
  const out: WebSearchSource[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const item = sourceFromRecord({ title: match[1], url: match[2] }, provider);
    if (item) out.push(item);
  }
  return out;
}

/** Parse only explicit source records or Markdown links from a search tool result. */
export function parseWebSearchSources(
  output: unknown,
  toolName = "",
): WebSearchSource[] {
  const provider = providerFromHint(toolName);
  if (!provider) return [];
  const payload = parseJson(output);
  const label = provider[0].toUpperCase() + provider.slice(1);
  if (typeof payload === "string") {
    return provider === "kimi"
      ? parseExplicitMarkdownLinks(payload, label)
      : [];
  }
  return rowsFromPayload(payload)
    .map((row) => sourceFromRecord(row, label))
    .filter((source): source is WebSearchSource => Boolean(source));
}
