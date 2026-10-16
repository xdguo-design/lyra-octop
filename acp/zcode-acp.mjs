#!/usr/bin/env node
/**
 * ZCode ACP adapter — exposes the local ZCode CLI as an ACP (Agent Client
 * Protocol v1) agent so Octop experts can delegate coding work to ZCode.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (per ACP spec).
 * Each session/prompt runs `zcode -p "<task>" --mode yolo` headless in the
 * session cwd; stdout is streamed back as agent_message_chunk updates.
 *
 * Env overrides:
 *   ZCODE_BIN  absolute path to zcode.cjs (default: local ZCode install)
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = 1;
const DEFAULT_ZCODE_BIN = "D:\\Programs\\ZCode\\resources\\glm\\zcode.cjs";
const zcodeBin = process.env.ZCODE_BIN || DEFAULT_ZCODE_BIN;

/** runner name -> { cwd, child } */
const sessions = new Map();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function agentMessageChunk(sessionId, text) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function promptText(params) {
  const blocks = Array.isArray(params?.prompt) ? params.prompt : [];
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

async function handlePrompt(id, params) {
  const sessionId = params?.session_id ?? params?.sessionId;
  const session = sessions.get(sessionId);
  const cwd = session?.cwd || process.cwd();
  const task = promptText(params);

  if (!task) {
    replyError(id, -32602, "prompt must contain at least one text block");
    return;
  }
  if (session?.child) {
    replyError(id, -32000, "a prompt is already running in this session");
    return;
  }

  const child = spawn(
    process.execPath,
    [
      zcodeBin,
      "-p",
      task,
      "--mode",
      "yolo",
      "--locale",
      "zh-CN",
      "--cwd",
      cwd,
    ],
    { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (session) session.child = child;

  let received = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (!chunk) return;
    received = true;
    agentMessageChunk(sessionId, chunk);
  });
  // The CLI logs progress to stderr; keep it out of the protocol stream.
  child.stderr.resume();

  const done = new Promise((resolve) => child.on("close", resolve));
  const code = await done;
  if (session) session.child = null;
  if (!received) {
    agentMessageChunk(
      sessionId,
      code === 0 ? "（ZCode 无输出）" : `（ZCode 异常退出，退出码 ${code}）`,
    );
  }
  reply(id, { stopReason: "end_turn" });
}

async function dispatch(method, id, params) {
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false, promptCapabilities: {} },
        agentInfo: { name: "ZCode", version: "0.16.9" },
      });
      return;
    case "session/new": {
      const sessionId = randomUUID();
      sessions.set(sessionId, {
        cwd: typeof params?.cwd === "string" && params.cwd ? params.cwd : process.cwd(),
        child: null,
      });
      reply(id, { sessionId, sessionMetadata: { title: "ZCode" } });
      return;
    }
    case "session/prompt":
      await handlePrompt(id, params);
      return;
    case "session/cancel": {
      const sessionId = params?.session_id ?? params?.sessionId;
      const session = sessions.get(sessionId);
      if (session?.child) {
        session.child.kill();
        session.child = null;
      }
      reply(id, {});
      return;
    }
    case "session/close": {
      const sessionId = params?.session_id ?? params?.sessionId;
      const session = sessions.get(sessionId);
      if (session?.child) session.child.kill();
      sessions.delete(sessionId);
      reply(id, {});
      return;
    }
    default:
      if (id !== undefined && id !== null) {
        replyError(id, -32601, `method not found: ${method}`);
      }
  }
}

if (!existsSync(zcodeBin)) {
  process.stderr.write(`[zcode-acp] zcode CLI not found at ${zcodeBin}\n`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg && typeof msg.method === "string") {
    void dispatch(msg.method, msg.id, msg.params).catch((err) => {
      replyError(msg.id, -32000, String(err?.message || err));
    });
  }
});
rl.on("close", () => {
  for (const session of sessions.values()) session.child?.kill();
  process.exit(0);
});
