import { beforeEach, expect, it, vi } from "vitest";

const { request, requestBlob } = vi.hoisted(() => ({
  request: vi.fn().mockResolvedValue({}),
  requestBlob: vi.fn().mockResolvedValue(new Blob()),
}));
vi.mock("../request", () => ({ request, requestBlob }));
import { presentationsApi } from "./presentations";

beforeEach(() => vi.clearAllMocks());

it("scopes every presentation request to an encoded agent and deck", async () => {
  await presentationsApi.get("agent/a", "deck/b");
  expect(request).toHaveBeenCalledWith(
    "/agents/agent%2Fa/presentations/deck%2Fb",
  );
  await presentationsApi.job("a", "d", {
    revision: 3,
    action: "revise",
    page_id: "page-1",
    instruction: "Shorter title",
  });
  expect(request).toHaveBeenLastCalledWith(
    "/agents/a/presentations/d/jobs",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        revision: 3,
        action: "revise",
        page_id: "page-1",
        instruction: "Shorter title",
      }),
    }),
  );
});

it("downloads a real authenticated blob from the deck endpoint", async () => {
  await presentationsApi.download("a", "d");
  expect(requestBlob).toHaveBeenCalledWith(
    "/agents/a/presentations/d/download",
  );
});

it("reads the draft conversation before a deck exists", async () => {
  await presentationsApi.chatLog("agent/a");
  expect(request).toHaveBeenCalledWith("/agents/agent%2Fa/presentations/chat");
});
