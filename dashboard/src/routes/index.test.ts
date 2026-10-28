import { describe, expect, it } from "vitest";

import { pathToKey, resolveSelectedKey, routeConfigs } from "./index";

describe("runs routes", () => {
  it("maps the run list and detail to the same navigation item", () => {
    expect(pathToKey["/runs"]).toBe("runs");
    expect(resolveSelectedKey("/runs/run-123")).toBe("runs");
    expect(routeConfigs.map((route) => route.path)).toContain("/runs");
    expect(routeConfigs.map((route) => route.path)).toContain("/runs/:runId");
  });
});

describe("additional page routes", () => {
  it("registers the project, application and administration pages", () => {
    const paths = routeConfigs.map((route) => route.path);
    expect(paths).toContain("/projects/:projectId");
    expect(paths).toContain("/apps");
    expect(paths).toContain("/admin/overview");
    expect(resolveSelectedKey("/apps")).toBe("apps");
    expect(resolveSelectedKey("/admin/overview")).toBe("admin-overview");
  });
});
