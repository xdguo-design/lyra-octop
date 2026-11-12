// 本地开发直连控制台端口；远程部署走同域 HTTPS 反代的 /ehr-console/ 路径。
const LOCAL_CONSOLE_PORT = 5191;
const REMOTE_CONSOLE_PATH = "/ehr-console/";

const isLocalHostname = (hostname: string) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);

export function ehrPlatformLoginUrl(): string {
  const configuredBase = import.meta.env.VITE_EHR_CONSOLE_URL?.trim();
  const { hostname, protocol } = window.location;
  const base =
    configuredBase ||
    (isLocalHostname(hostname)
      ? `${protocol}//${hostname}:${LOCAL_CONSOLE_PORT}`
      : `https://${hostname}${REMOTE_CONSOLE_PATH}`);
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const url = new URL("login", normalizedBase);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_EHR_CONSOLE_URL must use HTTP or HTTPS");
  }
  if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
    throw new Error("EHR console URLs outside localhost must use HTTPS");
  }

  return url.toString();
}
