import { Form, Select } from "antd";
import { useTranslation } from "react-i18next";
import type { ReasoningCapability } from "../../../api/types/provider";

export default function AgentModelReasoningFields({
  capability,
}: {
  capability?: ReasoningCapability | null;
}) {
  const { t } = useTranslation();
  const mode = Form.useWatch("reasoning_mode");
  if (!capability) return null;
  if (capability.adapter === "status_only")
    return <p>{t("chat.reasoningAlways")}</p>;
  return (
    <>
      <Form.Item name="reasoning_mode" label={t("chat.reasoningMode")}>
        <Select
          options={[
            { value: "auto", label: t("chat.reasoningAuto") },
            { value: "enabled", label: t("chat.reasoningEnabled") },
            ...(capability.toggle
              ? [{ value: "disabled", label: t("chat.reasoningDisabled") }]
              : []),
          ]}
        />
      </Form.Item>
      <Form.Item name="reasoning_effort" label={t("chat.reasoningEffort")}>
        <Select
          allowClear
          disabled={mode === "disabled" || capability.efforts.length === 0}
          placeholder={t(
            capability.efforts.length
              ? "experts.reasoningDefaultEffort"
              : "experts.reasoningToggleOnly",
          )}
          options={capability.efforts.map((effort) => ({
            value: effort,
            label: effort,
          }))}
        />
      </Form.Item>
    </>
  );
}
