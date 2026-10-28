import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createTextFileRevision: vi.fn(),
  createThreadTextFile: vi.fn(),
  getFile: vi.fn(),
  listThreadFiles: vi.fn(),
  readTextFileRevision: vi.fn(),
}));
const i18n = vi.hoisted(() => ({
  t: (key: string, options?: { branch?: string }) =>
    options?.branch ? `${key} ${options.branch}` : key,
}));

vi.mock("../../../api/modules/files", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => i18n,
}));
vi.mock("@/utils/antdMessage", () => ({
  message: { error: vi.fn(), success: vi.fn() },
}));

import { ThreadTextArtifactDialog } from "./ThreadTextArtifactDialog";

describe("ThreadTextArtifactDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listThreadFiles.mockResolvedValue([]);
  });

  it("creates a thread-bound text file", async () => {
    api.createThreadTextFile.mockResolvedValue({
      file_id: "file-1",
      current_revision_id: "revision-1",
    });

    render(
      <ThreadTextArtifactDialog
        open
        agentId="agent-1"
        threadId="thread-1"
        onClose={vi.fn()}
      />,
    );

    const createButton = screen.getByRole("button", {
      name: "chat.textArtifacts.create",
    });
    fireEvent.change(screen.getByLabelText("chat.textArtifacts.filename"), {
      target: { value: "summary.md" },
    });
    fireEvent.change(screen.getByLabelText("chat.textArtifacts.content"), {
      target: { value: "# Summary" },
    });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);

    await waitFor(() =>
      expect(api.createThreadTextFile).toHaveBeenCalledWith(
        "agent-1",
        "thread-1",
        {
          filename: "summary.md",
          content: "# Summary",
        },
      ),
    );
  });

  it("only offers generated DOCX files to the Markdown editor", async () => {
    api.listThreadFiles.mockResolvedValue([
      {
        file_id: "generated-docx",
        display_name: "generated.docx",
        media_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byte_size: 10,
        read_status: "ready",
        current_revision_id: "revision-1",
        origin_kind: "generated",
        created_at: 1,
        updated_at: 1,
      },
      {
        file_id: "uploaded-docx",
        display_name: "uploaded.docx",
        media_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byte_size: 10,
        read_status: "ready",
        current_revision_id: "revision-2",
        origin_kind: "upload",
        created_at: 1,
        updated_at: 1,
      },
    ]);

    render(
      <ThreadTextArtifactDialog
        open
        agentId="agent-1"
        threadId="thread-1"
        onClose={vi.fn()}
      />,
    );

    const combo = await screen.findByRole("combobox", {
      name: "chat.textArtifacts.existing",
    });
    fireEvent.mouseDown(combo);
    expect(await screen.findByText("generated.docx")).toBeInTheDocument();
    expect(screen.queryByText("uploaded.docx")).not.toBeInTheDocument();
  });

  it("shows both conflicting versions and saves an edited merge", async () => {
    api.listThreadFiles
      .mockResolvedValueOnce([
        {
          file_id: "file-1",
          display_name: "draft.md",
          media_type: "text/markdown",
          byte_size: 3,
          read_status: "ready",
          current_revision_id: "revision-1",
          origin_kind: "generated",
          created_at: 1,
          updated_at: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          file_id: "file-1",
          display_name: "draft.md",
          media_type: "text/markdown",
          byte_size: 11,
          read_status: "ready",
          current_revision_id: "revision-3",
          origin_kind: "generated",
          created_at: 1,
          updated_at: 3,
        },
      ]);
    api.readTextFileRevision
      .mockResolvedValueOnce({
        file_id: "file-1",
        revision_id: "revision-1",
        content: "old",
      })
      .mockResolvedValueOnce({
        file_id: "file-1",
        revision_id: "revision-2",
        content: "remote draft",
      })
      .mockResolvedValue({
        file_id: "file-1",
        revision_id: "revision-3",
        content: "merged draft",
      });
    api.createTextFileRevision
      .mockRejectedValueOnce(
        new Error('FILE_REVISION_CONFLICT "revision_id":"branch-1"'),
      )
      .mockResolvedValueOnce({ current_revision_id: "revision-3" });
    api.getFile.mockResolvedValue({ current_revision_id: "revision-2" });

    render(
      <ThreadTextArtifactDialog
        open
        agentId="agent-1"
        threadId="thread-1"
        onClose={vi.fn()}
      />,
    );

    const combo = await screen.findByRole("combobox", {
      name: "chat.textArtifacts.existing",
    });
    fireEvent.mouseDown(combo);
    fireEvent.click(await screen.findByText("draft.md"));
    const editor = await screen.findByRole("textbox", {
      name: "chat.textArtifacts.content",
    });
    await waitFor(() => expect(editor).toHaveValue("old"));
    fireEvent.change(editor, { target: { value: "local draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: "chat.textArtifacts.saveRevision" }),
    );

    const conflict = await screen.findByRole("alert");
    expect(conflict).toHaveTextContent("branch-1");
    expect(conflict).toHaveTextContent("remote draft");
    expect(
      screen.getByRole("region", { name: "chat.textArtifacts.diffTitle" }),
    ).toHaveTextContent(/− remote draft\+ local draft/);
    expect(editor).toHaveValue("local draft");
    const saveMerged = screen.getByRole("button", {
      name: "chat.textArtifacts.saveMerged",
    });
    expect(saveMerged).toBeDisabled();
    fireEvent.change(editor, {
      target: { value: "local draft\nremote draft preserved" },
    });
    fireEvent.click(saveMerged);
    await waitFor(() =>
      expect(api.createTextFileRevision).toHaveBeenCalledTimes(2),
    );
    expect(api.createTextFileRevision).toHaveBeenLastCalledWith(
      "agent-1",
      "file-1",
      {
        thread_id: "thread-1",
        base_revision_id: "revision-2",
        content: "local draft\nremote draft preserved",
      },
    );
  });
});
