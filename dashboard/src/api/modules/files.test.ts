import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("../request", () => ({ request: requestMock }));

import {
  createTextFileRevision,
  createThreadTextFile,
  readTextFileRevision,
} from "./files";

describe("text file APIs", () => {
  beforeEach(() => requestMock.mockReset());

  it("creates a thread-owned text file", async () => {
    requestMock.mockResolvedValue({ file_id: "file-1" });
    await createThreadTextFile("agent/1", "thread 1", {
      filename: "draft.md",
      content: "# Draft",
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/agents/agent%2F1/threads/thread%201/files",
      {
        method: "POST",
        body: JSON.stringify({ filename: "draft.md", content: "# Draft" }),
      },
    );
  });

  it("sends the base revision when appending an edit", async () => {
    requestMock.mockResolvedValue({ file_id: "file-1" });
    await createTextFileRevision("agent-1", "file-1", {
      thread_id: "thread-1",
      base_revision_id: "revision-1",
      content: "revised",
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/agents/agent-1/files/file-1/revisions",
      {
        method: "POST",
        body: JSON.stringify({
          thread_id: "thread-1",
          base_revision_id: "revision-1",
          content: "revised",
        }),
      },
    );
  });

  it("reads text through the owner and thread checked endpoint", async () => {
    requestMock.mockResolvedValue({ file_id: "file-1", content: "text" });
    await readTextFileRevision("agent-1", "file-1", "rev-1", "thread 1");

    expect(requestMock).toHaveBeenCalledWith(
      "/agents/agent-1/files/file-1/revisions/rev-1/text?thread_id=thread+1",
    );
  });
});
