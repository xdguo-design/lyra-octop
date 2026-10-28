import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "@/utils/antdMessage";
import { uploadFile } from "../../../api/modules/upload";
import type { ChatAttachment } from "./useChat";
import { useChatAttachments } from "./useChatAttachments";

vi.mock("../../../hooks/useServerUploadLimit", () => ({
  useServerUploadLimit: () => ({ maxUploadBytes: 1024 * 1024, maxUploadMb: 1 }),
}));

vi.mock("../../../api/modules/upload", () => ({
  uploadFile: vi.fn(),
}));

vi.mock("@/utils/antdMessage", () => ({
  message: { error: vi.fn(), warning: vi.fn() },
}));

/** Full server payload shape, including the identity fields the composer keeps. */
function uploadResponse(name: string) {
  return {
    path: `inbound/${name}`,
    workspace_path: `inbound/${name}`,
    filename: name,
    media_type: "text/plain",
    url: "",
    access_url: `/files/${name}`,
    file_id: `file-${name}`,
    revision_id: `rev-${name}`,
    size: "7",
    read_status: "stored",
  };
}

function textFile(name: string): File {
  return new File([name], name, { type: "text/plain" });
}

describe("useChatAttachments cleanup states (P0 acceptance)", () => {
  beforeEach(() => {
    vi.mocked(uploadFile).mockReset();
    vi.mocked(message.error).mockReset();
    vi.mocked(message.warning).mockReset();
    vi.mocked(uploadFile).mockImplementation(async (_agentId, file) =>
      uploadResponse(file.name),
    );
  });

  it("keeps the server file identity on every attachment", async () => {
    const { result } = renderHook(() => useChatAttachments("agent-1"));
    await act(async () => {
      await result.current.processFiles([textFile("a.txt")]);
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(result.current.attachments[0]).toMatchObject({
      filename: "a.txt",
      fileId: "file-a.txt",
      revisionId: "rev-a.txt",
      workspacePath: "inbound/a.txt",
    });
  });

  it("removes only the targeted attachment when one is removed manually", async () => {
    const { result } = renderHook(() => useChatAttachments("agent-1"));
    await act(async () => {
      await result.current.processFiles([
        textFile("a.txt"),
        textFile("b.txt"),
        textFile("c.txt"),
      ]);
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(3));

    act(() => {
      result.current.removeAttachment(1);
    });

    expect(result.current.attachments.map((item) => item.filename)).toEqual([
      "a.txt",
      "c.txt",
    ]);
    expect(result.current.items).toHaveLength(2);
    expect(result.current.uploading).toBe(false);
  });

  it("clears every attachment when the input area is cleared", async () => {
    const { result } = renderHook(() => useChatAttachments("agent-1"));
    await act(async () => {
      await result.current.processFiles([textFile("a.txt"), textFile("b.txt")]);
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(2));

    act(() => {
      result.current.clearAttachments();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.attachments).toEqual([]);
    expect(result.current.uploading).toBe(false);
  });

  it("restores a queued/thread draft as done items", () => {
    const { result } = renderHook(() => useChatAttachments("agent-1"));
    const restored: ChatAttachment[] = [
      {
        url: "/files/x.txt",
        filename: "x.txt",
        mediaType: "text/plain",
        workspacePath: "inbound/x.txt",
        fileId: "file-x",
        revisionId: "rev-x",
        kind: "file",
      },
    ];

    act(() => {
      result.current.restoreAttachments(restored);
    });

    expect(result.current.attachments).toEqual(restored);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].status).toBe("done");
    expect(result.current.uploading).toBe(false);
  });

  it("drops attachments on agent switch and blocks late completions from landing", async () => {
    let release:
      | ((value: ReturnType<typeof uploadResponse>) => void)
      | undefined;
    vi.mocked(uploadFile).mockImplementation(
      (_agentId, file) =>
        new Promise((resolve) => {
          release = () => resolve(uploadResponse(file.name));
        }),
    );
    const { result, rerender } = renderHook(
      ({ agentId }: { agentId: string }) => useChatAttachments(agentId),
      { initialProps: { agentId: "agent-1" } },
    );

    await act(async () => {
      void result.current.processFiles([textFile("a.txt")]);
      await Promise.resolve();
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.uploading).toBe(true);

    rerender({ agentId: "agent-2" });
    expect(result.current.items).toEqual([]);
    expect(result.current.attachments).toEqual([]);
    expect(result.current.uploading).toBe(false);

    // The in-flight upload belongs to agent-1; its late result must not land.
    await act(async () => {
      release?.();
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.attachments).toEqual([]);
  });

  it("keeps a failed upload out of the attachment list until retried", async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useChatAttachments("agent-1"));

    await act(async () => {
      await result.current.processFiles([textFile("a.txt")]);
    });
    await waitFor(() => expect(result.current.items[0].status).toBe("failed"));
    expect(result.current.attachments).toEqual([]);

    await act(async () => {
      result.current.retryUpload(result.current.items[0].key);
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(result.current.items[0].status).toBe("done");
  });
});
