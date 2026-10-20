import { describe, expect, it } from "vitest";

import {
  filterAndSortResources,
  type UnifiedResource,
} from "./resourceCatalog";

function resource(
  overrides: Partial<UnifiedResource> &
    Pick<UnifiedResource, "key" | "kind" | "name">,
): UnifiedResource {
  return {
    description: "",
    category: "",
    enabled: false,
    ...overrides,
  };
}

describe("filterAndSortResources", () => {
  it("filters across resource kinds and puts enabled matches first stably", () => {
    const resources = [
      resource({
        key: "expert:same",
        kind: "expert",
        name: "Calendar Expert",
        enabled: false,
      }),
      resource({
        key: "skill:same",
        kind: "skill",
        name: "Calendar skill",
        enabled: true,
      }),
      resource({
        key: "connector:same",
        kind: "connector",
        name: "Calendar Connector",
        enabled: true,
      }),
      resource({
        key: "skill:reader",
        kind: "skill",
        name: "PDF reader",
        enabled: false,
      }),
    ];

    expect(
      filterAndSortResources(resources, "  calendar ", "all").map(
        (item) => item.key,
      ),
    ).toEqual(["skill:same", "connector:same", "expert:same"]);
    expect(
      filterAndSortResources(resources, "calendar", "connector").map(
        (item) => item.key,
      ),
    ).toEqual(["connector:same"]);
  });

  it("searches descriptions and categories case-insensitively", () => {
    const resources = [
      resource({
        key: "skill:a",
        kind: "skill",
        name: "写作",
        description: "Markdown tools",
        category: "Office",
      }),
    ];

    expect(filterAndSortResources(resources, " markdown ", "all")).toHaveLength(
      1,
    );
    expect(filterAndSortResources(resources, "OFFICE", "all")).toHaveLength(1);
    expect(filterAndSortResources(resources, "missing", "all")).toEqual([]);
  });
});
