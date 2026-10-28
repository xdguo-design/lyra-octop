import { useEffect } from "react";
import { Alert, Button, Space, Spin, Typography } from "antd";
import { ehrPlatformLoginUrl } from "./ehrPlatformLoginUrl";

export default function EhrLoginRedirect() {
  const loginUrl = ehrPlatformLoginUrl();

  useEffect(() => {
    window.location.replace(loginUrl);
  }, [loginUrl]);

  return (
    <main
      style={{
        display: "grid",
        minHeight: "100vh",
        placeItems: "center",
        padding: 24,
        background: "#f5f7fa",
      }}
    >
      <Space direction="vertical" align="center" size="middle">
        <Spin size="large" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          正在打开 ehr-platform 正式登录页
        </Typography.Title>
        <Alert
          type="info"
          showIcon
          message="此入口跳转到 EHR 平台控制台登录，不在 Octop 中模拟 HIS 登录。"
        />
        <Button type="primary" href={loginUrl}>
          如果没有自动跳转，点击继续
        </Button>
      </Space>
    </main>
  );
}
