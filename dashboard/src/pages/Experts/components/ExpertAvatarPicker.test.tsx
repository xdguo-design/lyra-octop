import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExpertAvatarPicker from "./ExpertAvatarPicker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../Chat/components/ExpertAgentAvatar", () => ({
  default: () => <span>avatar</span>,
}));

describe("ExpertAvatarPicker", () => {
  it("shows only oil painting presets and selects the chosen painting", () => {
    const onSelectIcon = vi.fn();
    render(<ExpertAvatarPicker onPick={vi.fn()} onSelectIcon={onSelectIcon} />);

    expect(screen.queryByText("experts.avatarSamples")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .filter(
          (button) =>
            button
              .getAttribute("aria-label")
              ?.startsWith("experts.avatarPreset.painting-"),
        ),
    ).toHaveLength(12);

    fireEvent.click(
      screen.getByRole("button", {
        name: "experts.avatarPreset.painting-botanist",
      }),
    );
    expect(onSelectIcon).toHaveBeenCalledWith("painting-botanist");
  });
});
