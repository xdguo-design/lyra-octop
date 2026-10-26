import { describe, expect, it } from "vitest";
import {
  firstMissingField,
  firstMissingRequired,
  mergeCandidates,
  mockHisSubmit,
} from "./flow";

describe("admission demo conversation field handling", () => {
  it("accepts several fields from one realistic sentence and advances to the next missing field", () => {
    const candidates = {
      contact_name: "王晓梅",
      relationship: "女儿",
      contact_phone: "13800138000",
      address: "北京市朝阳区示例路 8 号",
    };
    const fields = mergeCandidates(
      {},
      candidates,
      "我是王晓梅，患者的女儿，手机号 13800138000，住北京市朝阳区示例路 8 号。",
    );

    expect(fields).toMatchObject(candidates);
    expect(firstMissingField(fields)).toBe("emergency_contact");
  });

  it("does not accept ambiguous or invalid phone values from model candidates", () => {
    const fields = mergeCandidates(
      {},
      {
        contact_name: "王晓梅或王晓兰",
        contact_phone: "13800138000 或 13900139000",
        emergency_phone: "138 0013 8000",
        address: "北京市朝阳区示例路 8 号",
      },
    );

    expect(fields).toEqual({ address: "北京市朝阳区示例路 8 号" });
    expect(firstMissingField(fields)).toBe("contact_name");
  });

  it("rejects a model-selected value when the customer's original sentence is ambiguous", () => {
    const fields = mergeCandidates(
      {},
      { contact_phone: "13800138000", contact_name: "王晓梅" },
      "联系人手机号是 13800138000 还是 13900139000，我还没确定。",
    );

    expect(fields).toEqual({});
  });

  it("restores a model-masked phone only when its suffix uniquely matches the original sentence", () => {
    const fields = mergeCandidates(
      {},
      {
        contact_phone: "****8000",
        emergency_phone: "****9000",
      },
      "联系人手机号 13800138000，紧急联系人手机号 13900139000。",
    );

    expect(fields).toEqual({
      contact_phone: "13800138000",
      emergency_phone: "13900139000",
    });
  });

  it("requires every field before allowing the flow to advance", () => {
    expect(
      firstMissingField({
        contact_name: "王晓梅",
        relationship: "女儿",
        contact_phone: "13800138000",
        address: "北京市朝阳区示例路 8 号",
        emergency_contact: "王建国",
        emergency_phone: "13900139000",
      }),
    ).toBeNull();
  });

  it("treats the contact name as optional for the details form but the five shown fields as required", () => {
    expect(
      firstMissingRequired({
        contact_phone: "13800138000",
        emergency_contact: "王建国",
        emergency_phone: "13900139000",
        relationship: "女儿",
        address: "北京市朝阳区示例路 8 号",
      }),
    ).toBeNull();

    expect(
      firstMissingRequired({
        contact_phone: "13800138000",
        emergency_contact: "王建国",
        emergency_phone: "13900139000",
      }),
    ).toBe("relationship");

    expect(firstMissingRequired({})).toBe("contact_phone");
  });

  it("returns the same mock HIS receipt for repeated submissions of one application", () => {
    expect(mockHisSubmit("ZY-DEMO-20261017-001")).toEqual(
      mockHisSubmit("ZY-DEMO-20261017-001"),
    );
  });
});
