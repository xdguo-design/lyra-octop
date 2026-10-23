import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnifiedResourceBrowser } from "./UnifiedResourceBrowser";
import type { UnifiedResource } from "./resourceCatalog";

const resources: UnifiedResource[] = [
  {
    key: "skill:calendar",
    kind: "skill",
    name: "Calendar skill",
    description: "schedule events",
    category: "Office",
    enabled: true,
  },
  {
    key: "expert:calendar",
    kind: "expert",
    name: "Calendar expert",
    description: "calendar helper",
    category: "Work",
    enabled: false,
  },
  {
    key: "connector:mail",
    kind: "connector",
    name: "Mail connector",
    description: "send mail",
    category: "Email",
    enabled: true,
  },
];

describe("UnifiedResourceBrowser", () => {
  it("shows one cross-category search and sorts enabled matches first", () => {
    render(
      <UnifiedResourceBrowser
        resources={resources}
        loading={false}
        errors={{}}
        availableKinds={["expert", "skill", "connector"]}
        onRetry={() => undefined}
        renderResource={(resource) => (
          <button data-testid="resource">{resource.name}</button>
        )}
      />,
    );

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("resource").map((node) => node.textContent),
    ).toEqual(["Calendar skill", "Mail connector", "Calendar expert"]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "calendar" },
    });
    expect(
      screen.getAllByTestId("resource").map((node) => node.textContent),
    ).toEqual(["Calendar skill", "Calendar expert"]);
  });

  it("combines the type filter with the search query", () => {
    render(
      <UnifiedResourceBrowser
        resources={resources}
        loading={false}
        errors={{}}
        availableKinds={["expert", "skill", "connector"]}
        onRetry={() => undefined}
        renderResource={(resource) => (
          <button data-testid="resource">{resource.name}</button>
        )}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "calendar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "专家" }));
    const resultGrid = screen.getByTestId("unified-resource-grid");
    expect(
      within(resultGrid)
        .getAllByTestId("resource")
        .map((node) => node.textContent),
    ).toEqual(["Calendar expert"]);
  });
});
