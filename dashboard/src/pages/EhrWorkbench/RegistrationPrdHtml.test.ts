// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import registrationPrdHtml from "./registration-prd/挂号PRD.html?raw";
import registrationAnalysisData from "./registration-prd/workbench/call-analysis-data.js?raw";
import registrationLegacySource from "./registration-prd/workbench/analyzer/data/legacy-source-snapshots.js?raw";
import registrationPrdActions from "./registration-prd/workbench/prd-actions.js?raw";
import registrationActionsAdapter from "./registration-prd/workbench/analyzer/registration-actions-adapter.js?raw";
import registrationWorkbenchView from "./registration-prd/workbench/analyzer/workbench-view.js?raw";

function openRegistrationPrd() {
  return new JSDOM(registrationPrdHtml, {
    runScripts: "dangerously",
    url: "http://localhost/prd.html",
  });
}

function openRegistrationWorkbench() {
  const dom = new JSDOM(
    `<!doctype html><body>
      <button id="viewTabAnalysis"></button><button id="viewTabCanvas"></button>
      <nav id="analysisModeTabs"><button id="analysisModeGraph"></button><button id="analysisModeFull"></button><button id="analysisModeGuide"></button></nav>
      <main id="workbenchShell"><section id="analysisTopContent"><section id="call-graph"></section></section>
        <section id="hierarchyExplanation"></section><section id="methodGuideView"></section>
        <section id="canvasView"><iframe id="canvasFrame"></iframe></section>
      </main><select id="eventSelect"><option value="PRD_E_01">E-01</option><option value="PRD_E_06">E-06</option></select>
      <div id="componentTree"></div><div id="prdActionSummary"></div>
    </body>`,
    {
      runScripts: "dangerously",
      url: "http://localhost/workbench/call-analysis.html",
    },
  );
  dom.window.eval(registrationAnalysisData);
  dom.window.eval(registrationLegacySource);
  dom.window.eval(registrationPrdActions);
  dom.window.eval(registrationActionsAdapter);
  return dom;
}

describe("registration PRD HTML prototype", () => {
  it("offers all 43 actions across the five canonical prototype pages", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    const select = document.querySelector<HTMLSelectElement>("#action-select")!;
    const ids = new Set<string>();
    for (const pageId of ["P01", "P02", "P03", "P04", "P05"]) {
      document
        .querySelector<HTMLButtonElement>(`[data-page="${pageId}"]`)!
        .click();
    }

    const actionGroups = [...select.querySelectorAll("optgroup")];
    expect(actionGroups).toHaveLength(5);
    actionGroups.forEach((group) =>
      [...group.querySelectorAll("option")].forEach((option) =>
        ids.add(option.value),
      ),
    );
    expect(select.options).toHaveLength(43);
    expect(ids.size).toBe(43);
    expect(document.querySelectorAll(".demo-screen")).toHaveLength(5);
    expect(document.querySelectorAll("#prototype img")).toHaveLength(0);
    expect(
      document.querySelectorAll("#prototype input").length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelectorAll("#prototype table").length,
    ).toBeGreaterThan(0);
    dom.window.close();
  });

  it("gates E-14 on patient and schedule, then requires separate E-21 confirmation", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    document.querySelector<HTMLButtonElement>('[data-page="P02"]')!.click();
    const earlyPaymentFlow =
      document.querySelector<HTMLElement>('[data-flow="P02"]')!;
    expect(earlyPaymentFlow.textContent).toContain(
      "需从 P01 完成 E-14 后才可结算",
    );
    expect(
      earlyPaymentFlow.querySelector('[data-demo-action="confirm"]'),
    ).toBeDisabled();
    document.querySelector<HTMLButtonElement>('[data-page="P01"]')!.click();
    const flow = document.querySelector<HTMLElement>('[data-flow="P01"]')!;

    const submit = () =>
      document.querySelector<HTMLButtonElement>(
        '[data-flow="P01"] [data-demo-action="submit"]',
      )!;
    expect(submit()).toBeDisabled();
    flow
      .querySelector<HTMLButtonElement>('[data-demo-action="lookup-patient"]')!
      .click();
    expect(submit()).toBeDisabled();
    flow
      .querySelector<HTMLButtonElement>('[data-demo-action="query-schedule"]')!
      .click();
    document
      .querySelector<HTMLTableRowElement>('[data-schedule="S-1001"]')!
      .click();
    expect(submit()).toBeEnabled();
    submit().click();

    const paymentTab =
      document.querySelector<HTMLButtonElement>('[data-page="P02"]')!;
    expect(paymentTab).toHaveAttribute("aria-pressed", "true");
    const paymentFlow =
      document.querySelector<HTMLElement>('[data-flow="P02"]')!;
    const confirm = paymentFlow.querySelector<HTMLButtonElement>(
      '[data-demo-action="confirm"]',
    )!;
    expect(confirm).toBeDisabled();
    paymentFlow
      .querySelector<HTMLButtonElement>('[data-demo-action="check-invoice"]')!
      .click();
    const paymentMethod = paymentFlow.querySelector<HTMLSelectElement>(
      '[data-field="paymentMethod"]',
    )!;
    paymentMethod.value = "现金";
    paymentMethod.dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    const enabledConfirm = paymentFlow.querySelector<HTMLButtonElement>(
      '[data-demo-action="confirm"]',
    )!;
    expect(enabledConfirm).toBeEnabled();
    enabledConfirm.click();
    expect(document.querySelector('[data-page="P01"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      document.querySelector<HTMLSelectElement>("#action-select")?.value,
    ).toBe("E-21");
    expect(document.querySelector('[data-flow="P01"]')?.textContent).toContain(
      "DEMO-0001",
    );
    dom.window.close();
  });

  it("shows action-specific use, data, side effects, and follow-up method details", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    const select = document.querySelector<HTMLSelectElement>("#action-select")!;
    select.value = "E-14";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const details = document.querySelector<HTMLElement>("#method-detail")!;
    expect(details.textContent).toContain("怎么使用");
    expect(details.textContent).toContain("查询/读取数据");
    expect(details.textContent).toContain("数据操作/副作用");
    expect(details.textContent).toContain("后续流程");
    expect(details.textContent).toContain("进入 P02");
    expect(details.textContent).toContain("E-21");
    expect(
      document.querySelector('.method-links a[href="#data"]'),
    ).toBeTruthy();
    dom.window.close();
  });

  it("updates the method panel when a user clicks an E action in the workbench", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    const patientFlow =
      document.querySelector<HTMLElement>('[data-flow="P01"]')!;
    patientFlow
      .querySelector<HTMLButtonElement>(
        '[data-demo-action="lookup-patient"][data-action-id="E-04"]',
      )!
      .click();

    expect(
      document.querySelector<HTMLSelectElement>("#action-select")?.value,
    ).toBe("E-04");
    expect(
      document.querySelector<HTMLElement>("#method-detail")?.textContent,
    ).toContain("设备读取证件号，再以证件号查询患者主索引");

    document
      .querySelector<HTMLTableRowElement>('[data-schedule="S-1001"]')!
      .click();
    expect(
      document.querySelector<HTMLSelectElement>("#action-select")?.value,
    ).toBe("E-15");
    expect(
      document.querySelector<HTMLElement>("#method-detail")?.textContent,
    ).toContain("只维护前端选择态");

    const methodHeading = document.querySelector("#method-detail-title")!;
    const actionSelect = document.querySelector("#action-select")!;
    expect(
      actionSelect.compareDocumentPosition(methodHeading) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    dom.window.close();
  });

  it("matches the call-analysis workbench with linked canvas, call graph, and method guide", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    document
      .querySelector<HTMLButtonElement>(
        '[data-flow="P01"] [data-demo-action="lookup-patient"][data-action-id="E-04"]',
      )!
      .click();

    expect(document.querySelector('[data-tree-action="E-04"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(document.querySelector("#graph-title")?.textContent).toContain(
      "调用链",
    );
    expect(document.querySelector("#call-graph")?.textContent).toContain(
      "设备读取证件号，再以证件号查询患者主索引",
    );
    expect(document.querySelector("#full-explanation")?.textContent).toContain(
      "设备读取证件号，再以证件号查询患者主索引",
    );

    document.querySelector<HTMLButtonElement>('[data-view="graph"]')!.click();
    expect(document.querySelector("#graph-workspace")).not.toHaveProperty(
      "hidden",
      true,
    );
    expect(document.querySelector("#canvas-workspace")).toHaveProperty(
      "hidden",
      true,
    );

    document.querySelector<HTMLButtonElement>('[data-mode="guide"]')!.click();
    document
      .querySelector<HTMLButtonElement>(
        '#method-guide [data-method-index="1"]',
      )!
      .click();
    expect(
      document.querySelector('#method-guide [data-method-index="1"]'),
    ).toHaveAttribute("aria-current", "true");
    expect(document.querySelector("#guide-detail")?.textContent).toContain(
      "设备读取证件号，再以证件号查询患者主索引",
    );
    dom.window.close();
  });

  it("maps all 43 PRD actions to the source analysis model without inventing missing code", () => {
    const dom = openRegistrationWorkbench();
    const data = (
      dom.window as unknown as { CLINIC_REG_CALL_ANALYSIS_DATA: any }
    ).CLINIC_REG_CALL_ANALYSIS_DATA;
    expect(Object.keys(data.events)).toHaveLength(43);
    expect(data.events.PRD_E_01.methodIds).toContain("L003_SCHEDULE_QUERY");
    expect(data.events.PRD_E_21.methodIds).toEqual([
      "L003_REGIST_COMMIT",
      "L020_REGIST_COMMIT",
    ]);
    expect(data.events.PRD_E_06.status).toBe("UNKNOWN");
    expect(data.events.PRD_E_06.methodIds).toEqual([]);
    expect(data.events.PRD_E_A01.status).toBe("INFERRED");
    expect(data.events.PRD_E_A01.methodIds).toContain("L003_REGIST_CMD");
    const source = (
      dom.window as unknown as {
        CLINIC_REG_LEGACY_SOURCE: Record<string, Array<{ path: string }>>;
      }
    ).CLINIC_REG_LEGACY_SOURCE;
    expect(source.L020_REGIST_COMMIT[0].path).toContain(
      "CommitRcptRegisterAmbCommand.java",
    );
    expect(data.prdActionEvidence.unmappedCount).toBeGreaterThan(0);
    dom.window.close();
  });

  it("switches workbench views and maps registration canvas events back to PRD actions", () => {
    const dom = openRegistrationWorkbench();
    const { document } = dom.window;
    dom.window.eval(registrationWorkbenchView);

    document.querySelector<HTMLButtonElement>("#viewTabCanvas")!.click();
    expect(document.querySelector("#canvasView")).not.toHaveProperty(
      "hidden",
      true,
    );
    expect(document.querySelector("#analysisModeTabs")).toHaveProperty(
      "hidden",
      true,
    );

    const frame = document.querySelector<HTMLIFrameElement>("#canvasFrame")!;
    frame.dispatchEvent(new dom.window.Event("load"));
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        source: frame.contentWindow,
        origin: "http://localhost",
        data: {
          source: "pd-reg-canvas",
          type: "runtime-link",
          modelEventId: "EVT_SCHEDULE_QUERY",
        },
      }),
    );
    expect(
      document.querySelector<HTMLSelectElement>("#eventSelect")?.value,
    ).toBe("PRD_E_01");

    document.querySelector<HTMLButtonElement>("#viewTabAnalysis")!.click();
    document.querySelector<HTMLButtonElement>("#analysisModeFull")!.click();
    expect(document.querySelector("#hierarchyExplanation")).not.toHaveProperty(
      "hidden",
      true,
    );
    expect(document.querySelector("#analysisTopContent")).toHaveProperty(
      "hidden",
      true,
    );
    expect(
      document.querySelector<HTMLSelectElement>("#eventSelect")?.value,
    ).toBe("PRD_E_01");
    dom.window.close();
  });

  it("keeps the clicked E-14 method selected when its flow opens P02", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    const patientFlow =
      document.querySelector<HTMLElement>('[data-flow="P01"]')!;
    patientFlow
      .querySelector<HTMLButtonElement>(
        '[data-demo-action="lookup-patient"][data-action-id="E-08"]',
      )!
      .click();
    document
      .querySelector<HTMLTableRowElement>('[data-schedule="S-1001"]')!
      .click();
    patientFlow
      .querySelector<HTMLButtonElement>(
        '[data-demo-action="submit"][data-action-id="E-14"]',
      )!
      .click();

    expect(document.querySelector('[data-page="P02"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      document.querySelector<HTMLSelectElement>("#action-select")?.value,
    ).toBe("E-14");
    expect(
      document.querySelector<HTMLElement>("#method-detail")?.textContent,
    ).toContain("进入 P02");

    document.querySelector<HTMLButtonElement>('[data-page="P02"]')!.click();
    expect(
      document.querySelector<HTMLSelectElement>("#action-select")?.value,
    ).toBe("E-21");
    dom.window.close();
  });

  it("explains the selected department source and distinguishes legacy from mock data", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    const flow = document.querySelector<HTMLElement>('[data-flow="P01"]')!;
    const department = flow.querySelector<HTMLSelectElement>(
      '[data-field="dept"]',
    )!;
    department.value = "儿科";
    department.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const source = flow.querySelector<HTMLElement>(".field-source-card")!;
    expect(source.querySelector("summary")?.textContent).toContain("儿科");
    expect(source.textContent).toContain("原型内置");
    expect(source.textContent).toContain("GET patad/amb/schedule/list/regist");
    expect(source.textContent).toContain("AMB_SCHEDULING_REG");
    expect(source.textContent).toContain("orgCode");
    expect(source.textContent).toContain("UNKNOWN");
    expect(
      document.querySelector<HTMLSelectElement>("#action-select")?.value,
    ).toBe("E-01");
    dom.window.close();
  });

  it("keeps unresolved appointment take disabled and blocks duplicate card creation", () => {
    const dom = openRegistrationPrd();
    const document = dom.window.document;
    document.querySelector<HTMLButtonElement>('[data-page="P03"]')!.click();
    const appointmentFlow =
      document.querySelector<HTMLElement>('[data-flow="P03"]')!;
    expect(
      appointmentFlow.querySelector('[data-demo-action="take"]'),
    ).toBeDisabled();
    const date = appointmentFlow.querySelector<HTMLInputElement>(
      '[data-field="appointmentDate"]',
    )!;
    date.value = "2026-11-04";
    date.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    appointmentFlow
      .querySelector<HTMLButtonElement>('[data-demo-action="book"]')!
      .click();
    expect(appointmentFlow.textContent).toContain("预约已创建");
    appointmentFlow
      .querySelector<HTMLButtonElement>('[data-demo-action="cancel-booking"]')!
      .click();
    expect(appointmentFlow.textContent).toContain("预约已取消");

    document.querySelector<HTMLButtonElement>('[data-page="P05"]')!.click();
    const patientFlow =
      document.querySelector<HTMLElement>('[data-flow="P05"]')!;
    patientFlow
      .querySelector<HTMLButtonElement>('[data-demo-action="duplicate"]')!
      .click();
    expect(
      patientFlow.querySelector('[data-demo-action="create-card"]'),
    ).toBeDisabled();
    dom.window.close();
  });
});
