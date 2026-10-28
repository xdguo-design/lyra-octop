const localConsoleBase = () =>
  `${window.location.protocol}//${window.location.hostname}:5190`;

export function ehrPlatformLoginUrl(): string {
  const configuredBase = import.meta.env.VITE_EHR_CONSOLE_URL?.trim();
  const base = configuredBase || localConsoleBase();
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const url = new URL("login", normalizedBase);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_EHR_CONSOLE_URL must use HTTP or HTTPS");
  }

  return url.toString();
}
