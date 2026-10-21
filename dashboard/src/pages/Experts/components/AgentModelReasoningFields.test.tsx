import { Form } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReasoningCapability } from "../../../api/types/provider";
import AgentModelReasoningFields from "./AgentModelReasoningFields";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const capability: ReasoningCapability = {
  supported: true,
  toggle: true,
  default_mode: "auto",
  efforts: ["low", "high"],
  effort_type: "enum",
  adapter: "openai_reasoning_effort",
};

describe("expert model reasoning", () => {
  it("offers a disabled mode when the model supports toggling reasoning", async () => {
    render(
      <Form initialValues={{ reasoning_mode: "enabled" }}>
        <AgentModelReasoningFields capability={capability} />
      </Form>,
    );
    fireEvent.mouseDown(screen.getByLabelText("chat.reasoningMode"));
    expect(
      await screen.findByText("chat.reasoningDisabled"),
    ).toBeInTheDocument();
  });
  it("offers the model's supported effort values and stores the selection", async () => {
    let values: Record<string, unknown> = {};
    render(
      <Form
        initialValues={{ reasoning_mode: "enabled" }}
        onValuesChange={(_changed, all) => {
          values = all;
        }}
      >
        <AgentModelReasoningFields capability={capability} />
      </Form>,
    );
    fireEvent.mouseDown(screen.getByLabelText("chat.reasoningEffort"));
    fireEvent.click(await screen.findByTitle("high"));
    expect(values.reasoning_effort).toBe("high");
  });

  it("does not offer fake effort levels for a toggle-only model", () => {
    render(
      <Form initialValues={{ reasoning_mode: "enabled" }}>
        <AgentModelReasoningFields
          capability={{ ...capability, adapter: "chat_template", efforts: [] }}
        />
      </Form>,
    );
    expect(screen.getByLabelText("chat.reasoningEffort")).toBeDisabled();
    expect(screen.getByText("experts.reasoningToggleOnly")).toBeInTheDocument();
    expect(screen.getByLabelText("chat.reasoningMode")).not.toBeDisabled();
  });

  it("preserves an expert override that differs from the model default", () => {
    render(
      <Form initialValues={{ reasoning_mode: "enabled" }}>
        <AgentModelReasoningFields
          capability={{ ...capability, default_mode: "disabled", efforts: [] }}
        />
      </Form>,
    );
    expect(screen.getByText("chat.reasoningEnabled")).toBeInTheDocument();
  });

  it("disables effort when thinking is disabled", () => {
    render(
      <Form initialValues={{ reasoning_mode: "disabled" }}>
        <AgentModelReasoningFields capability={capability} />
      </Form>,
    );
    expect(screen.getByLabelText("chat.reasoningEffort")).toBeDisabled();
  });
});
