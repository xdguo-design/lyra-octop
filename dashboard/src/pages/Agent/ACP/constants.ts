import opencodeIcon from "../../../assets/acp/opencode.svg";
import codebuddyIcon from "../../../assets/acp/codebuddy.png";
import anthropicIcon from "../../../assets/providers/anthropic.png";
import openaiIcon from "../../../assets/providers/openai.png";
import moonshotIcon from "../../../assets/acp/moonshot.png";
import cursorIcon from "../../../assets/acp/cursor.png";
import piIcon from "../../../assets/acp/pi.png";
import zcodeIcon from "../../../assets/acp/zcode.png";
import customRunnerIcon from "../../../assets/providers/custom-provider.svg";

/** Built-in ACP runner ids (order preserved in the grid). */
export const BUILTIN_RUNNER_ORDER = [
  "zcode",
  "opencode",
  "codebuddy",
  "claude_code",
  "codex",
  "kimi_code",
  "cursor_cli",
  "pi",
  "kilo_code",
  "kiro_cli",
] as const;

export type BuiltinRunnerKey = (typeof BUILTIN_RUNNER_ORDER)[number];

export function isBuiltinRunner(key: string): key is BuiltinRunnerKey {
  return (BUILTIN_RUNNER_ORDER as readonly string[]).includes(key);
}

export const RUNNER_ICONS: Record<string, string> = {
  zcode: zcodeIcon,
  opencode: opencodeIcon,
  codebuddy: codebuddyIcon,
  claude_code: anthropicIcon,
  codex: openaiIcon,
  kimi_code: moonshotIcon,
  cursor_cli: cursorIcon,
  pi: piIcon,
  kilo_code: customRunnerIcon,
};

export const RUNNER_LABEL_KEYS: Record<string, string> = {
  zcode: "acp.runner_zcode",
  opencode: "acp.runner_opencode",
  codebuddy: "acp.runner_codebuddy",
  claude_code: "acp.runner_claude_code",
  codex: "acp.runner_codex",
  kimi_code: "acp.runner_kimi_code",
  cursor_cli: "acp.runner_cursor_cli",
  pi: "acp.runner_pi",
  kilo_code: "acp.runner_kilo_code",
  kiro_cli: "acp.runner_kiro_cli",
};

export const RUNNER_INTRO_KEYS: Record<string, string> = {
  zcode: "acp.intro_zcode",
  opencode: "acp.intro_opencode",
  codebuddy: "acp.intro_codebuddy",
  claude_code: "acp.intro_claude_code",
  codex: "acp.intro_codex",
  kimi_code: "acp.intro_kimi_code",
  cursor_cli: "acp.intro_cursor_cli",
  pi: "acp.intro_pi",
  kilo_code: "acp.intro_kilo_code",
  kiro_cli: "acp.intro_kiro_cli",
};

export function runnerIcon(key: string): string {
  return RUNNER_ICONS[key] ?? customRunnerIcon;
}

export function runnerLabelKey(key: string): string {
  return RUNNER_LABEL_KEYS[key] ?? "acp.runner_custom";
}

export function runnerIntroKey(key: string): string {
  return RUNNER_INTRO_KEYS[key] ?? "acp.intro_custom";
}
