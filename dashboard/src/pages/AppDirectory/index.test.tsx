import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../api/modules/creations", () => ({ creationsApi: mocks }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../layouts/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
import AppDirectoryPage from ".";

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ items: [] });
});

describe("AppDirectoryPage", () => {
  it("lists internal applications and opens the creation manager", () => {
    render(
      <MemoryRouter initialEntries={["/apps"]}>
        <Routes>
          <Route path="/apps" element={<AppDirectoryPage />} />
          <Route path="/creations" element={<div>manager</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("pptStudio.title")).toBeInTheDocument();
    expect(
      screen.getByText("creationsPage.builtIn.ehrKnowledgePlatform"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("creationsPage.builtIn.lyraPrint"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "appDirectoryPage.manage" }),
    );
    expect(screen.getByText("manager")).toBeInTheDocument();
  });

  it("lists and searches the current user's applications", async () => {
    mocks.list.mockResolvedValue({
      items: [{ item_id: "mine", name: "My service", description: "Example" }],
    });
    render(
      <MemoryRouter>
        <AppDirectoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("My service")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("appDirectoryPage.search"), {
      target: { value: "My service" },
    });
    expect(screen.queryByText("pptStudio.title")).not.toBeInTheDocument();
    expect(screen.getByText("My service")).toBeInTheDocument();
  });

  it("offers retry when the personal application list fails", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    render(
      <MemoryRouter>
        <AppDirectoryPage />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "common.retry" }),
    );
    expect(await screen.findByText("pptStudio.title")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
