import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageFileCard } from "./MessageFileCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("../ChatFilePreviewContext", () => ({
  useChatFilePreview: () => null,
}));

describe("MessageFileCard", () => {
  it("shows partial file-read coverage in the conversation", () => {
    render(
      <MessageFileCard
        url="/download"
        filename="report.pdf"
        readStatus="partial"
      />,
    );

    expect(screen.getByText("Partially read")).toBeInTheDocument();
  });

  it("tells the user when scanned pages need OCR", () => {
    render(
      <MessageFileCard
        url="/download"
        filename="scan.pdf"
        readStatus="needs_ocr"
      />,
    );

    expect(screen.getByText("Scanned pages need OCR")).toBeInTheDocument();
  });

  it("shows when an image was omitted by the model image limit", () => {
    render(
      <MessageFileCard
        url="/download"
        filename="photo.png"
        readStatus="not_sent"
      />,
    );

    expect(
      screen.getByText("Image limit reached; not sent to the model"),
    ).toBeInTheDocument();
  });
});
