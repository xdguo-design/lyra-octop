import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WebSearchSource } from "../../../utils/parseWebSearchSources";
import { WebSearchSourcesStrip } from "./WebSearchSourcesStrip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "chat.webSources.label" ? "Web sources" : key) }),
}));

const sources: WebSearchSource[] = [
  {
    title: "Example result",
    url: "https://example.com/article",
    snippet: "Result summary",
    provider: "Tavily",
  },
];

describe("WebSearchSourcesStrip", () => {
  it("renders secure external source links with provider labels", () => {
    render(<WebSearchSourcesStrip sources={sources} />);
    const link = screen.getByRole("link", { name: /Example result Tavily/ });
    expect(link).toHaveAttribute("href", "https://example.com/article");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByLabelText("Web sources")).toBeInTheDocument();
  });

  it("renders nothing when no validated sources are present", () => {
    const { container } = render(<WebSearchSourcesStrip sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
