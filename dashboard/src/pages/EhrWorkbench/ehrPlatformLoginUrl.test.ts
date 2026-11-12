// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ehrPlatformLoginUrl } from "./ehrPlatformLoginUrl";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ehrPlatformLoginUrl", () => {
  it("uses the local development console on localhost", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost", protocol: "http:" },
    });

    expect(ehrPlatformLoginUrl()).toBe("http://localhost:5191/login");
  });

  it("uses the HTTPS console path for a remote Octop host", () => {
    vi.stubGlobal("window", {
      location: { hostname: "119.3.216.103", protocol: "http:" },
    });

    expect(ehrPlatformLoginUrl()).toBe(
      "https://119.3.216.103/ehr-console/login",
    );
  });

  it("rejects a configured console base that is not HTTP or HTTPS", () => {
    vi.stubEnv("VITE_EHR_CONSOLE_URL", "ftp://console.example.com");
    vi.stubGlobal("window", {
      location: { hostname: "localhost", protocol: "http:" },
    });

    expect(() => ehrPlatformLoginUrl()).toThrow(
      "VITE_EHR_CONSOLE_URL must use HTTP or HTTPS",
    );
  });

  it("rejects a configured remote console base served over HTTP", () => {
    vi.stubEnv("VITE_EHR_CONSOLE_URL", "http://console.example.com");
    vi.stubGlobal("window", {
      location: { hostname: "119.3.216.103", protocol: "http:" },
    });

    expect(() => ehrPlatformLoginUrl()).toThrow(
      "EHR console URLs outside localhost must use HTTPS",
    );
  });
});
