import { Cable, Mail } from "lucide-react";

import {
  getConnectorLogo,
  getConnectorLogoForUrl,
} from "../../../assets/connectors";
import type { ConnectorCatalogEntry } from "../../../api/modules/connectors";
import styles from "./index.module.less";

export const MAIL_PROVIDERS = [
  {
    id: "qq",
    guideUrl: "https://mail.qq.com/",
    emailPlaceholder: "you@qq.com",
  },
  {
    id: "netease",
    guideUrl: "https://mail.163.com/",
    emailPlaceholder: "you@163.com / you@126.com",
  },
  {
    id: "gmail",
    guideUrl: "https://mail.google.com/",
    emailPlaceholder: "you@gmail.com",
  },
  {
    id: "custom",
    guideUrl: null,
    emailPlaceholder: "you@example.com",
  },
] as const;

export type MailProviderId = (typeof MAIL_PROVIDERS)[number]["id"];

/** Connectors that use inline credential guide links instead of top auth buttons. */
export const INLINE_CREDENTIAL_GUIDE_KINDS = new Set(["qq-mail"]);

/** Connectors with a top auth button — hide redundant links under form fields. */
export const HIDE_INLINE_FIELD_GUIDE_KINDS = new Set([
  "tencent-ima",
  "tencent-lexiang",
  "tencent-meeting",
  "tencent-news",
  "wechat-reading",
  "youdao-note",
  "meituan-travel",
  "yuandian",
]);

export function mailProviderById(id: string | undefined) {
  return MAIL_PROVIDERS.find((item) => item.id === id) ?? MAIL_PROVIDERS[0];
}

export function connectorAccent(
  entry: Pick<ConnectorCatalogEntry, "kind" | "color">,
): string {
  return entry.color || "#1677ff";
}

export function ConnectorLogo({
  kind,
  icon,
  name,
  url,
  size = 22,
}: {
  kind: string;
  icon?: string | null;
  /** 实例/服务器显示名（如 "GitHub"/"Vercel"），用于自定义 MCP 的品牌图标。 */
  name?: string | null;
  /** 服务器 URL，按官方端点识别品牌。 */
  url?: string | null;
  size?: number;
}) {
  const src =
    getConnectorLogo(kind) ??
    (icon ? getConnectorLogo(icon) : undefined) ??
    getConnectorLogo((name ?? "").trim()) ??
    getConnectorLogoForUrl(url);
  if (!src) {
    const Icon = kind === "agently-cli" ? Mail : Cable;
    return (
      <Icon
        size={size}
        className={styles.connectorMcpFallbackIcon}
        aria-hidden
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={styles.connectorLogo}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
