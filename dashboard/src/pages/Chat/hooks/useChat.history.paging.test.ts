import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { octopThreadsApi } from "../../../api/modules/octopThreads";
import * as chatStore from "./chatStore";
import { useChat } from "./useChat";

// useChat pulls in a heavy module graph; the first render in a file costs
// several seconds in this environment. Keep the per-test budget generous.
const SLOW = 25_000;

const THREAD_A = "p0-paging-thread-a";
const THREAD_B = "p0-paging-thread-b";

afterEach(() => {
  vi.restoreAllMocks();
  chatStore.removeSession(THREAD_A);
  chatStore.removeSession(THREAD_B);
});

function wireMessage(id: string, content: string) {
  return { id, role: "user", content, timestamp: 1 };
}

function historyPage(
  threadId: string,
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>,
  hasMore: boolean,
  nextCursor: string | null = null,
) {
  return {
    thread_id: threadId,
    messages,
    has_more: hasMore,
    next_cursor: nextCursor,
    turn_active: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useChat history paging under refresh / session switch (P0 acceptance)", () => {
  it(
    "prepends the older page and advances the cursor",
    async () => {
      chatStore.setHistoryPage(
        THREAD_A,
        [wireMessage("new1", "new1"), wireMessage("new2", "new2")],
        { hasMore: true, nextOffset: 25, nextCursor: "cursor-1" },
      );
      const history = vi
        .spyOn(octopThreadsApi, "history")
        .mockResolvedValue(
          historyPage(
            THREAD_A,
            [wireMessage("old1", "old1")],
            true,
            "cursor-2",
          ),
        );

      const { result } = renderHook(() => useChat(THREAD_A, "agent"));
      await act(async () => {
        await result.current.loadMoreHistory();
      });

      expect(history).toHaveBeenCalledWith(
        "agent",
        THREAD_A,
        expect.objectContaining({ offset: 25, cursor: "cursor-1" }),
      );
      const snapshot = chatStore.getSnapshot(THREAD_A);
      expect(snapshot.messages.map((m) => m.id)).toEqual([
        "old1",
        "new1",
        "new2",
      ]);
      expect(snapshot.historyHasMore).toBe(true);
      expect(snapshot.historyNextCursor).toBe("cursor-2");
      expect(snapshot.historyLoadingMore).toBe(false);
    },
    SLOW,
  );

  it(
    "keeps an older page that lands after a session switch inside the old session",
    async () => {
      chatStore.setHistoryPage(THREAD_A, [wireMessage("a-new", "a-new")], {
        hasMore: true,
        nextOffset: 25,
        nextCursor: "cursor-a",
      });
      const olderA = deferred<ReturnType<typeof historyPage>>();
      vi.spyOn(octopThreadsApi, "history").mockImplementation(
        async (_agent, threadId) => {
          if (threadId === THREAD_A) return olderA.promise;
          return historyPage(
            threadId,
            [wireMessage(`${threadId}-new`, "b-new")],
            false,
          );
        },
      );

      const { result, rerender } = renderHook(
        ({ sessionId }: { sessionId: string }) => useChat(sessionId, "agent"),
        { initialProps: { sessionId: THREAD_A } },
      );
      await act(async () => {
        void result.current.loadMoreHistory();
        await Promise.resolve();
      });

      // Switch to thread B and hydrate it while A's older page is still in flight.
      rerender({ sessionId: THREAD_B });
      await act(async () => {
        await result.current.loadHistory(THREAD_B);
      });
      expect(chatStore.getSnapshot(THREAD_B).messages.map((m) => m.id)).toEqual(
        [`${THREAD_B}-new`],
      );

      // A's older page finally lands: it must enrich A, never B.
      await act(async () => {
        olderA.resolve(
          historyPage(THREAD_A, [wireMessage("a-old", "a-old")], false),
        );
      });
      expect(chatStore.getSnapshot(THREAD_A).messages.map((m) => m.id)).toEqual(
        ["a-old", "a-new"],
      );
      expect(chatStore.getSnapshot(THREAD_B).messages.map((m) => m.id)).toEqual(
        [`${THREAD_B}-new`],
      );
      expect(chatStore.getSnapshot(THREAD_B).historyHasMore).toBe(false);
      expect(chatStore.getSnapshot(THREAD_B).historyNextCursor).toBe(null);
      expect(chatStore.getSnapshot(THREAD_B).historyLoadingMore).toBe(false);
    },
    SLOW,
  );

  it(
    "drops a stale initial load when a newer session already landed",
    async () => {
      const staleA = deferred<ReturnType<typeof historyPage>>();
      vi.spyOn(octopThreadsApi, "history").mockImplementation(
        async (_agent, threadId) => {
          if (threadId === THREAD_A) return staleA.promise;
          return historyPage(
            threadId,
            [wireMessage(`${threadId}-new`, "b-new")],
            false,
          );
        },
      );

      const { result, rerender } = renderHook(
        ({ sessionId }: { sessionId: string }) => useChat(sessionId, "agent"),
        { initialProps: { sessionId: THREAD_A } },
      );
      await act(async () => {
        void result.current.loadHistory(THREAD_A);
        await Promise.resolve();
      });

      rerender({ sessionId: THREAD_B });
      await act(async () => {
        await result.current.loadHistory(THREAD_B);
      });

      await act(async () => {
        staleA.resolve(
          historyPage(THREAD_A, [wireMessage("a-stale", "a-stale")], false),
        );
      });

      // B keeps its page; A's late response is dropped, not applied anywhere.
      expect(chatStore.getSnapshot(THREAD_B).messages.map((m) => m.id)).toEqual(
        [`${THREAD_B}-new`],
      );
      expect(chatStore.getSnapshot(THREAD_A).messages).toEqual([]);
      expect(chatStore.getSnapshot(THREAD_A).historyHydrated).toBe(false);
    },
    SLOW,
  );

  it(
    "refresh keeps prepended older pages and replaces only the overlapping window",
    async () => {
      chatStore.setHistoryPage(
        THREAD_A,
        [wireMessage("new1", "new1"), wireMessage("new2", "new2")],
        { hasMore: true, nextOffset: 25, nextCursor: "cursor-new" },
      );
      chatStore.prependHistoryMessages(
        THREAD_A,
        [wireMessage("old1", "old1")],
        { hasMore: true, nextOffset: 50, nextCursor: "cursor-old" },
      );
      vi.spyOn(octopThreadsApi, "history").mockResolvedValue(
        historyPage(
          THREAD_A,
          [
            wireMessage("new1", "new1"),
            wireMessage("new2", "new2"),
            wireMessage("new3", "new3"),
          ],
          true,
          "cursor-refreshed",
        ),
      );

      const { result } = renderHook(() => useChat(THREAD_A, "agent"));
      await act(async () => {
        await result.current.refreshHistory();
      });

      const snapshot = chatStore.getSnapshot(THREAD_A);
      expect(snapshot.messages.map((m) => m.id)).toEqual([
        "old1",
        "new1",
        "new2",
        "new3",
      ]);
      // Older pages stay pinned: the paging cursor must not jump backwards.
      expect(snapshot.historyHasMore).toBe(true);
      expect(snapshot.historyNextCursor).toBe("cursor-old");
      expect(snapshot.historyNextOffset).toBe(50);
      expect(result.current.historyError).toBe(false);
    },
    SLOW,
  );

  it(
    "refuses a second concurrent load-more while one is in flight",
    async () => {
      chatStore.setHistoryPage(THREAD_A, [wireMessage("new1", "new1")], {
        hasMore: true,
        nextOffset: 25,
        nextCursor: "cursor-1",
      });
      const older = deferred<ReturnType<typeof historyPage>>();
      const history = vi
        .spyOn(octopThreadsApi, "history")
        .mockImplementation(async () => older.promise);

      const { result } = renderHook(() => useChat(THREAD_A, "agent"));
      let firstPromise: Promise<boolean> | undefined;
      act(() => {
        firstPromise = result.current.loadMoreHistory();
      });
      expect(chatStore.getSnapshot(THREAD_A).historyLoadingMore).toBe(true);

      let secondStarted: boolean | undefined;
      await act(async () => {
        secondStarted = await result.current.loadMoreHistory();
      });
      expect(secondStarted).toBe(false);
      expect(history).toHaveBeenCalledTimes(1);

      await act(async () => {
        older.resolve(
          historyPage(THREAD_A, [wireMessage("old1", "old1")], false),
        );
        await firstPromise;
      });
      expect(chatStore.getSnapshot(THREAD_A).historyLoadingMore).toBe(false);
      expect(chatStore.getSnapshot(THREAD_A).messages.map((m) => m.id)).toEqual(
        ["old1", "new1"],
      );
    },
    SLOW,
  );
});
