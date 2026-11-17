import { describe, expect, it } from "vitest";
import type { BrowserElementInfo } from "../api/types/browser";
import {
  browserElementLabel,
  browserElementSize,
  describeBrowserElement,
  type ElementTranslate,
} from "./browserElement";

const element: BrowserElementInfo = {
  tag: "button",
  label: "",
  id: "submit",
  classes: ["primary", "large", "extra"],
  role: "button",
  type: "submit",
  name: "",
  placeholder: "",
  text: "提交订单",
  selector: "div#app > form.checkout > button.primary",
  rect: { x: 560.4, y: 412.6, width: 320.2, height: 44 },
  styles: {
    color: "rgb(255, 255, 255)",
    "background-color": "rgb(22, 119, 255)",
    "font-size": "14px",
    display: "inline-flex",
    position: "static",
    "border-radius": "6px",
    "border-color": "",
    "font-weight": "500",
  },
  attrs: { type: "submit" },
  url: "https://shop.example.com/cart",
  title: "购物车",
  viewport: { width: 1440, height: 900 },
};

/** Minimal stand-in for i18next `t`: resolves the key and interpolates. */
const t: ElementTranslate = (key, options) => {
  const labels: Record<string, string> = {
    "browserWorkspace.elementPickTitle": "网页组件",
    "browserWorkspace.elementPickHeading": "【{{title}}】{{label}}",
    "browserWorkspace.elementPickLine": "{{label}}：{{value}}",
    "browserWorkspace.elementPickSelector": "选择器",
    "browserWorkspace.elementPickText": "文本",
    "browserWorkspace.elementPickSize": "尺寸",
    "browserWorkspace.elementPickStyles": "样式",
    "browserWorkspace.elementPickPage": "页面",
  };
  const template = labels[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options?.[name] ?? ""),
  );
};

describe("browserElementLabel", () => {
  it("prefers the page-computed label", () => {
    expect(browserElementLabel({ ...element, label: "提交订单" })).toBe(
      "提交订单",
    );
  });

  it("falls back to tag + id + two classes", () => {
    expect(browserElementLabel(element)).toBe("button#submit.primary.large");
  });

  it("omits the id when the element has none", () => {
    expect(browserElementLabel({ ...element, id: "", classes: ["btn"] })).toBe(
      "button.btn",
    );
  });
});

describe("browserElementSize", () => {
  it("rounds CSS pixels and appends the origin", () => {
    expect(browserElementSize(element)).toBe("320 × 44 @ (560, 413)");
  });
});

describe("describeBrowserElement", () => {
  it("renders heading, selector, text, size, styles and page", () => {
    const text = describeBrowserElement(element, t);
    const lines = text.split("\n");

    expect(lines[0]).toBe("【网页组件】button#submit.primary.large");
    expect(lines[1]).toBe("选择器：div#app > form.checkout > button.primary");
    expect(lines[2]).toBe("文本：提交订单");
    expect(lines[3]).toBe("尺寸：320 × 44 @ (560, 413)");
    expect(lines[4]).toBe(
      "样式：color: rgb(255, 255, 255); background-color: rgb(22, 119, 255); font-size: 14px; display: inline-flex; position: static; border-radius: 6px",
    );
    expect(lines[5]).toBe("页面：购物车 — https://shop.example.com/cart");
    expect(lines).toHaveLength(6);
  });

  it("skips empty text, styles and page sections", () => {
    const text = describeBrowserElement(
      {
        ...element,
        text: "",
        styles: {},
        url: "",
        title: "",
      },
      t,
    );

    expect(text.split("\n")).toEqual([
      "【网页组件】button#submit.primary.large",
      "选择器：div#app > form.checkout > button.primary",
      "尺寸：320 × 44 @ (560, 413)",
    ]);
  });

  it("falls back to the label when the page has no selector", () => {
    const text = describeBrowserElement({ ...element, selector: "" }, t);
    expect(text.split("\n")[1]).toBe("选择器：button#submit.primary.large");
  });
});
