import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { octopThreadsApi } from "../../../api/modules/octopThreads";
import * as chatStore from "./chatStore";
import { useChat } from "./useChat";

const thread = "versioned-history-test";

afterEach(() => {
  vi.restoreAllMocks();
  chatStore.removeSession(thread);
});

describe("history failures", () => {
  it("keeps a loaded conversation and its cursor when refreshing fails", async () => {
    chatStore.setHistoryPage(
      thread,
      [{ id: "old", role: "user", content: "keep me", timestamp: 1 }],
      { hasMore: true, nextOffset: 25, nextCursor: "boundary" },
    );
    vi.spyOn(octopThreadsApi, "history").mockRejectedValue(
      new Error("archive unavailable"),
    );
    const { result } = renderHook(() => useChat(thread, "agent"));
    await act(async () => {
      await result.current.refreshHistory();
    });
    expect(result.current.historyError).toBe(true);
    expect(chatStore.getSnapshot(thread).messages[0].content).toBe("keep me");
    expect(chatStore.getSnapshot(thread).historyNextCursor).toBe("boundary");
    expect(chatStore.getSnapshot(thread).historyHasMore).toBe(true);
  });

  it("does not mark a failed initial load as an empty hydrated conversation", async () => {
    const history = vi
      .spyOn(octopThreadsApi, "history")
      .mockRejectedValueOnce(new Error("decode failed"));
    const { result } = renderHook(() => useChat(thread, "agent"));
    await act(async () => {
      await result.current.loadHistory(thread);
    });
    expect(result.current.historyError).toBe(true);
    expect(chatStore.getSnapshot(thread).historyHydrated).toBe(false);
    history.mockResolvedValueOnce({
      thread_id: thread,
      messages: [{ id: "ok", role: "user", content: "restored" }],
      has_more: false,
    });
    await act(async () => {
      await result.current.loadHistory(thread);
    });
    expect(result.current.historyError).toBe(false);
    expect(chatStore.getSnapshot(thread).historyHydrated).toBe(true);
    expect(chatStore.getSnapshot(thread).messages[0].content).toBe("restored");
  });

  it("refetches a thread cached as empty so background turns show up", async () => {
    chatStore.setHistoryPage(thread, [], {
      hasMore: false,
      nextOffset: 0,
      nextCursor: null,
    });
    const history = vi.spyOn(octopThreadsApi, "history").mockResolvedValue({
      thread_id: thread,
      messages: [{ id: "cron", role: "assistant", content: "task done" }],
      has_more: false,
    });
    const { result } = renderHook(() => useChat(thread, "agent"));
    await act(async () => {
      await result.current.loadHistory(thread);
    });
    expect(history).toHaveBeenCalled();
    expect(chatStore.getSnapshot(thread).messages[0].content).toBe("task done");
  });

  it("passes the pinned cursor when loading older messages", async () => {
    chatStore.setHistoryPage(
      thread,
      [{ id: "new", role: "user", content: "new", timestamp: 1 }],
      { hasMore: true, nextOffset: 25, nextCursor: "pinned-boundary" },
    );
    const history = vi
      .spyOn(octopThreadsApi, "history")
      .mockResolvedValue({ thread_id: thread, messages: [], has_more: false });
    const { result } = renderHook(() => useChat(thread, "agent"));
    await act(async () => {
      await result.current.loadMoreHistory();
    });
    expect(history).toHaveBeenCalledWith(
      "agent",
      thread,
      expect.objectContaining({ cursor: "pinned-boundary" }),
    );
  });

  it("drops an older-page response when a refresh starts while it is in flight", async () => {
    chatStore.setHistoryPage(
      thread,
      [{ id: "latest", role: "user", content: "latest", timestamp: 2 }],
      { hasMore: true, nextOffset: 25, nextCursor: "boundary" },
    );
    let resolveOlder!: (value: {
      thread_id: string;
      messages: { id: string; role: string; content: string }[];
      has_more: boolean;
    }) => void;
    let resolveLatest!: (value: {
      thread_id: string;
      messages: { id: string; role: string; content: string }[];
      has_more: boolean;
    }) => void;
    const olderRequest = new Promise<{
      thread_id: string;
      messages: { id: string; role: string; content: string }[];
      has_more: boolean;
    }>((resolve) => {
      resolveOlder = resolve;
    });
    const latestRequest = new Promise<{
      thread_id: string;
      messages: { id: string; role: string; content: string }[];
      has_more: boolean;
    }>((resolve) => {
      resolveLatest = resolve;
    });
    vi.spyOn(octopThreadsApi, "history")
      .mockReturnValueOnce(olderRequest)
      .mockReturnValueOnce(latestRequest);
    const { result } = renderHook(() => useChat(thread, "agent"));

    act(() => {
      void result.current.loadMoreHistory();
    });
    act(() => {
      void result.current.refreshHistory();
    });
    await act(async () => {
      resolveLatest({
        thread_id: thread,
        messages: [{ id: "latest", role: "user", content: "refreshed" }],
        has_more: true,
      });
      await latestRequest;
    });
    await act(async () => {
      resolveOlder({
        thread_id: thread,
        messages: [{ id: "old", role: "user", content: "stale older page" }],
        has_more: false,
      });
      await olderRequest;
    });

    expect(chatStore.getSnapshot(thread).messages.map((message) => message.id)).toEqual([
      "latest",
    ]);
  });

  it("retries the failed older page with the same cursor", async () => {
    chatStore.setHistoryPage(
      thread,
      [{ id: "latest", role: "user", content: "latest", timestamp: 1 }],
      { hasMore: true, nextOffset: 25, nextCursor: "same-boundary" },
    );
    const history = vi
      .spyOn(octopThreadsApi, "history")
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        thread_id: thread,
        messages: [{ id: "older", role: "user", content: "older" }],
        has_more: false,
      });
    const { result } = renderHook(() => useChat(thread, "agent"));
    await act(async () => {
      await result.current.loadMoreHistory();
    });
    expect(result.current.historyError).toBe(true);
    await act(async () => {
      await result.current.retryHistory();
    });
    expect(history).toHaveBeenLastCalledWith(
      "agent",
      thread,
      expect.objectContaining({ cursor: "same-boundary" }),
    );
    expect(result.current.historyError).toBe(false);
    expect(
      chatStore.getSnapshot(thread).messages.map((m) => m.content),
    ).toEqual(["older", "latest"]);
  });
});
