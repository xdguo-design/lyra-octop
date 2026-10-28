import { Alert, Card, Col, Row, Space, Tag, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import prdDocument from "./PRD.md?raw";
import styles from "./PrdSummary.module.less";

export default function PrdSummary() {
  const { t } = useTranslation();

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Link to="/ehr">← {t("ehrWorkbenchPage.homeTitle")}</Link>
          <Typography.Title level={2} style={{ marginTop: 16 }}>
            {t("ehrWorkbenchPage.prdSummaryTitle")}
          </Typography.Title>
          <Space>
            <Tag color="gold">PRD-001 · In Review</Tag>
            <Typography.Text type="secondary">
              {t("ehrWorkbenchPage.prdSummaryVersion")}
            </Typography.Text>
          </Space>
        </div>

        <Alert
          type="warning"
          showIcon
          message={t("ehrWorkbenchPage.prdSummaryStatus")}
          description={t("ehrWorkbenchPage.prdSummaryStatusDetail")}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title={t("ehrWorkbenchPage.prdScopeTitle")}>
              <Typography.Paragraph>
                {t("ehrWorkbenchPage.prdScope")}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                {t("ehrWorkbenchPage.prdAuthTarget")}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                {t("ehrWorkbenchPage.prdBaseline")}
              </Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={t("ehrWorkbenchPage.prdIntegrationTitle")}>
              <Typography.Paragraph>
                {t("ehrWorkbenchPage.prdIntegrationTodo")}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                {t("ehrWorkbenchPage.prdCurrentSlice")}
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>

        <Card title={t("ehrWorkbenchPage.prdImplementationTitle")}>
          <Typography.Paragraph type="secondary">
            {t("ehrWorkbenchPage.prdImplementationEvidence")}
          </Typography.Paragraph>
          <ul>
            <li>{t("ehrWorkbenchPage.prdImplementationPatient")}</li>
            <li>{t("ehrWorkbenchPage.prdImplementationCharge")}</li>
            <li>{t("ehrWorkbenchPage.prdImplementationExternal")}</li>
            <li>{t("ehrWorkbenchPage.prdImplementationRefund")}</li>
            <li>{t("ehrWorkbenchPage.prdImplementationAuth")}</li>
            <li>{t("ehrWorkbenchPage.prdImplementationCompatibility")}</li>
          </ul>
        </Card>

        <Card title={t("ehrWorkbenchPage.prdDeliveryTitle")}>
          <ul>
            <li>{t("ehrWorkbenchPage.prdDeliveryCharge")}</li>
            <li>{t("ehrWorkbenchPage.prdDeliveryDependencies")}</li>
            <li>{t("ehrWorkbenchPage.prdDeliveryAcceptance")}</li>
          </ul>
        </Card>

        <Card title={t("ehrWorkbenchPage.prdFullDocumentTitle")}>
          <Typography.Paragraph type="secondary">
            {t("ehrWorkbenchPage.prdDocumentSource")}
          </Typography.Paragraph>
          <article className={styles.prdDocument}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {prdDocument}
            </ReactMarkdown>
          </article>
        </Card>

        <Alert
          type="info"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message={t("ehrWorkbenchPage.prdUnknowns")}
          description={t("ehrWorkbenchPage.prdUnknownsDetail")}
        />
      </Space>
    </main>
  );
}
