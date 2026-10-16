import tencentArdot from "./tencent-ardot.png";
import baiduMap from "./baidu-map.png";
import ctripWendao from "./ctrip-wendao.png";
import didi from "./didi.svg";
import dida365 from "./dida365.png";
import dify from "./dify.svg";
import agentlyCli from "./agently-cli.png";
import feishuCli from "./feishu-cli.png";
import fliggy from "./fliggy.png";
import meituanTravel from "./meituan-travel.png";
import notion from "./notion.png";
import obsidianCli from "./obsidian-cli.svg";
import openalex from "./openalex.svg";
import qcc from "./qcc.png";
import qqMail from "./qq-mail.png";
import qqMusic from "./qq-music.png";
import tencentDocs from "./tencent-docs.png";
import tencentIma from "./tencent-ima.png";
import tencentMeeting from "./tencent-meeting.png";
import tencentNews from "./tencent-news.png";
import tencentLexiang from "./tencent-lexiang.png";
import tencentWeiyun from "./tencent-weiyun.png";
import wechatReading from "./wechat-reading.png";
import wecomCli from "./wecom-cli.png";
import weknora from "./weknora.svg";
import youdaoNote from "./youdao-note.png";
import yuandian from "./yuandian.png";
import vercel from "./vercel.svg";
import github from "./github.svg";

export const CONNECTOR_LOGOS: Record<string, string> = {
  "tencent-ardot": tencentArdot,
  "tencent-docs": tencentDocs,
  "baidu-map": baiduMap,
  "qq-mail": qqMail,
  "qq-music": qqMusic,
  fliggy,
  "ctrip-wendao": ctripWendao,
  didi,
  "meituan-travel": meituanTravel,
  yuandian,
  "tencent-ima": tencentIma,
  "agently-cli": agentlyCli,
  "feishu-cli": feishuCli,
  "wecom-cli": wecomCli,
  "tencent-lexiang": tencentLexiang,
  "tencent-meeting": tencentMeeting,
  notion,
  "obsidian-cli": obsidianCli,
  openalex,
  qcc,
  dida365: dida365,
  dify,
  "tencent-news": tencentNews,
  "wechat-reading": wechatReading,
  "youdao-note": youdaoNote,
  "tencent-weiyun": tencentWeiyun,
  weknora,
  vercel,
  github,
};

export function getConnectorLogo(kind: string): string | undefined {
  if (!kind) return undefined;
  const direct = CONNECTOR_LOGOS[kind];
  if (direct) return direct;
  // Tolerate minor kind drift between a connector instance and the catalog
  // (e.g. a dev-era "baidu_map" persisted on an instance vs the finalized
  // "baidu-map" used as the logo key). Without this, the chat connector
  // picker (which renders instance.kind) falls back to a placeholder while
  // the catalog grid (entry.kind) still shows the logo.
  const normalized = kind.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized !== kind) {
    const fallback = CONNECTOR_LOGOS[normalized];
    if (fallback) return fallback;
  }
  return undefined;
}

/** 自定义 MCP 地址 → 品牌图标（按 URL 识别官方服务）。 */
const BRAND_URL_LOGOS: Array<[RegExp, string]> = [
  [/mcp\.vercel\.com/i, "vercel"],
  [/githubcopilot\.com\/mcp|api\.github\.com|github\.com/i, "github"],
];

export function getConnectorLogoForUrl(
  url: string | undefined | null,
): string | undefined {
  if (!url) return undefined;
  for (const [pattern, key] of BRAND_URL_LOGOS) {
    if (pattern.test(url)) return CONNECTOR_LOGOS[key];
  }
  return undefined;
}
