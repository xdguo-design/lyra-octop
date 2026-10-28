// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "ehrWorkbenchPage.homeTitle": "EHR 知识工作站",
        "ehrWorkbenchPage.prdSummaryTitle": "门诊收费 PRD 汇总",
        "ehrWorkbenchPage.prdSummaryVersion": "修订 0.7",
        "ehrWorkbenchPage.prdSummaryStatus": "尚未交付完整闭环",
        "ehrWorkbenchPage.prdSummaryStatusDetail": "当前页面是安全演示",
        "ehrWorkbenchPage.prdScopeTitle": "首批交付范围",
        "ehrWorkbenchPage.prdScope": "收费及其依赖模块",
        "ehrWorkbenchPage.prdAuthTarget": "ehr-auth 本地账号首次启动创建管理员",
        "ehrWorkbenchPage.prdBaseline": "020 已确认作为目标院区基线",
        "ehrWorkbenchPage.prdIntegrationTitle": "外部接口状态",
        "ehrWorkbenchPage.prdIntegrationTodo": "医保、支付、票据未完成",
        "ehrWorkbenchPage.prdCurrentSlice": "现有代码仅为有限切片",
        "ehrWorkbenchPage.prdImplementationTitle": "020 基线实现状态",
        "ehrWorkbenchPage.prdImplementationEvidence":
          "基于 ehr-platform main@4170e95",
        "ehrWorkbenchPage.prdImplementationPatient":
          "患者查询：部分实现（演示）",
        "ehrWorkbenchPage.prdImplementationCharge": "收费草稿：部分实现（桩）",
        "ehrWorkbenchPage.prdImplementationExternal":
          "医保、支付、票据：未实现 / TODO",
        "ehrWorkbenchPage.prdImplementationRefund": "退费与日结：未实现",
        "ehrWorkbenchPage.prdImplementationAuth": "ehr-auth：尚未实现",
        "ehrWorkbenchPage.prdImplementationCompatibility": "003/020：未验收",
        "ehrWorkbenchPage.prdDeliveryTitle": "双向追溯要求",
        "ehrWorkbenchPage.prdDeliveryCharge":
          "需求映射前端、应用服务和领域规则",
        "ehrWorkbenchPage.prdDeliveryDependencies": "依赖各服务契约",
        "ehrWorkbenchPage.prdDeliveryAcceptance": "原型与真实前端一致",
        "ehrWorkbenchPage.prdFullDocumentTitle": "PRD 正文",
        "ehrWorkbenchPage.prdDocumentSource": "来自项目 PRD 文件的页面副本",
        "ehrWorkbenchPage.prdUnknowns": "未决规则",
        "ehrWorkbenchPage.prdUnknownsDetail": "Q-08 部分确认，其余问题未关闭",
      })[key] || key,
  }),
}));

import PrdSummary from "./PrdSummary";

describe("EHR PRD summary", () => {
  it("makes incomplete integrations and open business decisions explicit", () => {
    render(
      <MemoryRouter>
        <PrdSummary />
      </MemoryRouter>,
    );

    expect(screen.getByText("门诊收费 PRD 汇总")).toBeTruthy();
    expect(screen.getByText("医保、支付、票据未完成")).toBeTruthy();
    expect(screen.getByText("020 已确认作为目标院区基线")).toBeTruthy();
    expect(screen.getByText("020 基线实现状态")).toBeTruthy();
    expect(screen.getByText("患者查询：部分实现（演示）")).toBeTruthy();
    expect(screen.getByText("医保、支付、票据：未实现 / TODO")).toBeTruthy();
    expect(screen.getByText("退费与日结：未实现")).toBeTruthy();
    expect(screen.getByText("PRD 正文")).toBeTruthy();
    expect(screen.getByText("门诊收费产品需求（重梳理稿）")).toBeTruthy();
    expect(screen.getByText("Q-08 部分确认，其余问题未关闭")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /EHR 知识工作站/ }),
    ).toHaveAttribute("href", "/ehr");
  });
});
