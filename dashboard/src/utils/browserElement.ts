import type { BrowserElementInfo } from "../api/types/browser";

/** Translation helper shape used by dashboard pure utilities. */
export type ElementTranslate = (
  key: string,
  options?: Record<string, string | number>,
) => string;

const MAX_STYLE_FIELDS = 6;

/**
 * Short human handle for a picked element, e.g. `button#submit.primary`.
 *
 * Prefers the label computed on the page (aria-label / inner text), because it
 * is what the user actually recognizes in the page.
 */
export function browserElementLabel(info: BrowserElementInfo): string {
  if (info.label) return info.label;
  const classes = info.classes
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join("");
  return `${info.tag}${info.id ? `#${info.id}` : ""}${classes}`;
}

/** `320 × 44 @ (560, 412)` — CSS pixels in page-viewport space. */
export function browserElementSize(info: BrowserElementInfo): string {
  const { width, height, x, y } = info.rect;
  return `${Math.round(width)} × ${Math.round(height)} @ (${Math.round(
    x,
  )}, ${Math.round(y)})`;
}

function styleSummary(info: BrowserElementInfo): string {
  return Object.entries(info.styles)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "")
    .slice(0, MAX_STYLE_FIELDS)
    .map(([name, value]) => `${name}: ${value}`)
    .join("; ");
}

/**
 * Multi-line description of a picked page element, ready to be appended to the
 * chat composer so the assistant knows exactly what the user is pointing at.
 */
export function describeBrowserElement(
  info: BrowserElementInfo,
  t: ElementTranslate,
): string {
  const line = (label: string, value: string) =>
    t("browserWorkspace.elementPickLine", { label, value });

  const lines = [
    t("browserWorkspace.elementPickHeading", {
      title: t("browserWorkspace.elementPickTitle"),
      label: browserElementLabel(info),
    }),
    line(
      t("browserWorkspace.elementPickSelector"),
      info.selector || browserElementLabel(info),
    ),
  ];

  if (info.text) {
    lines.push(line(t("browserWorkspace.elementPickText"), info.text));
  }
  lines.push(
    line(t("browserWorkspace.elementPickSize"), browserElementSize(info)),
  );

  const styles = styleSummary(info);
  if (styles) {
    lines.push(line(t("browserWorkspace.elementPickStyles"), styles));
  }

  if (info.url) {
    const page = info.title ? `${info.title} — ${info.url}` : info.url;
    lines.push(line(t("browserWorkspace.elementPickPage"), page));
  }

  return lines.join("\n");
}
