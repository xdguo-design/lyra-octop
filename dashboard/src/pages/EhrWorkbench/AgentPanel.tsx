import {
  CodeOutlined,
  CloseOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";

interface DeliveryItem {
  id: string;
  title: string;
  status: "In Review" | "Partial";
  summaryKey: string;
  document: string;
  code: string[];
}

const DELIVERY_ITEMS: DeliveryItem[] = [
  {
    id: "PRD-001",
    title: "门诊收费产品需求",
    status: "In Review",
    summaryKey: "ehrWorkbenchPage.deliverySummaryPrd",
    document: "prd/经济/门诊收费/PRD-门诊收费-重梳理草案.md",
    code: [
      "frontend/ehr-finance-workbench/src/modules/charging/pages/ChargeWorkbenchPage.vue",
      "backend/ehr-charging/ehr-charging-api/src/main/java/com/company/ehr/charging/interfaces/http/chargeworkbench/ChargeWorkbenchController.java",
    ],
  },
  {
    id: "SPEC-UI",
    title: "页面与交互规格",
    status: "Partial",
    summaryKey: "ehrWorkbenchPage.deliverySummaryUi",
    document: "prd/经济/门诊收费/analysis/02-页面与交互规格.html",
    code: [
      "frontend/ehr-finance-workbench/src/modules/charging/pages/ChargeWorkbenchPage.vue",
      "frontend/ehr-finance-workbench/src/modules/charging/api/chargeWorkbenchApi.ts",
    ],
  },
  {
    id: "SPEC-DOMAIN",
    title: "领域数据与接口规格",
    status: "Partial",
    summaryKey: "ehrWorkbenchPage.deliverySummaryDomain",
    document: "prd/经济/门诊收费/analysis/03-领域数据与接口实现规格.html",
    code: [
      "backend/ehr-charging/contracts/openapi/ehr-charging-openapi.yaml",
      "backend/ehr-charging/ehr-charging-domain/src/main/java/com/company/ehr/charging/domain/draft/ChargeDraft.java",
      "backend/ehr-charging/ehr-charging-infrastructure/src/main/java/com/company/ehr/charging/infrastructure/persistence/ChargeDraftRepositoryAdapter.java",
    ],
  },
  {
    id: "SPEC-RULE",
    title: "业务规则与流程控制",
    status: "Partial",
    summaryKey: "ehrWorkbenchPage.deliverySummaryRules",
    document: "prd/经济/门诊收费/analysis/04-业务规则与流程控制.html",
    code: [
      "backend/ehr-charging/ehr-charging-application/src/main/java/com/company/ehr/charging/application/chargeworkbench/ChargeWorkbenchAppService.java",
      "backend/ehr-charging/ehr-charging-domain/src/main/java/com/company/ehr/charging/domain/draft/ChargeDraftStatus.java",
    ],
  },
  {
    id: "SPEC-AC",
    title: "技术集成与验收测试",
    status: "Partial",
    summaryKey: "ehrWorkbenchPage.deliverySummaryAcceptance",
    document: "prd/经济/门诊收费/analysis/05-技术集成与验收测试.html",
    code: [
      "backend/ehr-charging/ehr-charging-domain/src/test/java/com/company/ehr/charging/domain/draft/ChargeDraftTest.java",
      "backend/ehr-charging/ehr-charging-application/src/test/java/com/company/ehr/charging/application/chargeworkbench/ChargeWorkbenchAppServiceTest.java",
    ],
  },
];

function CodePath({ path, publicMode }: { path: string; publicMode: boolean }) {
  if (publicMode) {
    return (
      <span className="ehr-delivery-code-path" title={path}>
        <CodeOutlined /> {path.split("/").at(-1)}
      </span>
    );
  }
  return (
    <a
      className="ehr-delivery-code-path"
      href={`https://github.com/xdguo-design/ehr-platform/blob/main/${path}`}
      target="_blank"
      rel="noreferrer"
      title={path}
    >
      <CodeOutlined /> {path.split("/").at(-1)}
    </a>
  );
}

export default function AgentPanel({
  onClose,
  publicMode = false,
}: {
  onClose?: () => void;
  publicMode?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="ehr-agent-panel">
      <div className="ehr-agent-header">
        <Space>
          <Avatar size={28} src="/lyra-dino.svg" />
          <div>
            <Typography.Text strong>
              {t("ehrWorkbenchPage.deliveryCenter")}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                publicMode
                  ? "ehrWorkbenchPage.publicDeliverySubtitle"
                  : "ehrWorkbenchPage.deliverySubtitle",
              )}
            </Typography.Text>
          </div>
        </Space>
        {onClose && (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label={t("ehrWorkbenchPage.closeDelivery")}
            onClick={onClose}
          />
        )}
      </div>

      <div className="ehr-delivery-content">
        <section
          className="ehr-launch-card"
          aria-labelledby="ehr-project-title"
        >
          <div>
            <Typography.Text id="ehr-project-title" strong>
              {t("ehrWorkbenchPage.outpatientProject")}
            </Typography.Text>
            <div className="ehr-launch-meta">
              <Tag color="blue">dev</Tag>
              <Tag color="gold">{t("ehrWorkbenchPage.firstSlice")}</Tag>
              <Typography.Text type="secondary">
                Java 21 · Vue 3
              </Typography.Text>
            </div>
          </div>
          <Typography.Paragraph type="secondary">
            {t("ehrWorkbenchPage.outpatientStatus")}
          </Typography.Paragraph>
          {!publicMode && (
            <Space wrap>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                href="/charging/chargeworkbench"
                target="_blank"
              >
                {t("ehrWorkbenchPage.openRunningProject")}
              </Button>
              <Button href="/workbench">
                {t("ehrWorkbenchPage.codeWorkspace")}
              </Button>
            </Space>
          )}
        </section>

        <div className="ehr-delivery-heading">
          <Typography.Text strong>
            {t("ehrWorkbenchPage.deliveryMapping")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("ehrWorkbenchPage.deliveryItemsCount", {
              count: DELIVERY_ITEMS.length,
            })}
          </Typography.Text>
        </div>

        <div className="ehr-delivery-list">
          {DELIVERY_ITEMS.map((item) => (
            <details key={item.id} className="ehr-delivery-item">
              <summary>
                <span className="ehr-delivery-title">
                  <FileTextOutlined />
                  <span>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Text type="secondary">
                      {item.id}
                    </Typography.Text>
                  </span>
                </span>
                <Tag color={item.status === "In Review" ? "gold" : "blue"}>
                  {item.status}
                </Tag>
              </summary>
              <Typography.Paragraph>{t(item.summaryKey)}</Typography.Paragraph>
              <Typography.Text type="secondary" className="ehr-delivery-label">
                {t("ehrWorkbenchPage.documentSource")}
              </Typography.Text>
              <code className="ehr-delivery-doc-path">{item.document}</code>
              <Typography.Text type="secondary" className="ehr-delivery-label">
                {t("ehrWorkbenchPage.correspondingCode")}
              </Typography.Text>
              <div className="ehr-delivery-code-list">
                {item.code.map((path) => (
                  <CodePath key={path} path={path} publicMode={publicMode} />
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
