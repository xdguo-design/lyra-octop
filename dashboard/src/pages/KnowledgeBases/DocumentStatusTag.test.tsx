import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("antd", () => ({
  Tag: ({ children, color }: { children: React.ReactNode; color: string }) => (
    <span data-color={color}>{children}</span>
  ),
  Tooltip: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => <span title={title}>{children}</span>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import DocumentStatusTag from "./DocumentStatusTag";

describe("DocumentStatusTag", () => {
  it.each([
    ["pending", "default"],
    ["processing", "processing"],
    ["ready", "success"],
    ["failed", "error"],
  ] as const)(
    "renders %s with the matching status label and color",
    (status, color) => {
      render(<DocumentStatusTag status={status} />);

      expect(
        screen.getByText(`knowledgeBases.statusesShort.${status}`),
      ).toHaveAttribute("data-color", color);
    },
  );

  it("shows the server failure reason as the status tooltip", () => {
    render(
      <DocumentStatusTag status="failed" errorMessage="Unsupported file" />,
    );

    expect(screen.getByTitle("Unsupported file")).toHaveTextContent(
      "knowledgeBases.statusesShort.failed",
    );
  });
});
