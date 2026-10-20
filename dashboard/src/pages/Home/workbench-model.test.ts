import { describe, expect, it } from "vitest";
import type { OctopAgent } from "../../context/AgentContext";
import type { ChatMessage } from "../Chat/hooks/sseHelpers";
import {
  canDelegate,
  resolvePrivatePlatformUrl,
  selectPrimaryAgent,
  supportsLocalProjectPreview,
  visibleConversationMessages,
} from "./workbench-model";

const agent = (patch: Record<string, unknown>): OctopAgent =>
  ({
    agent_id: "agent",
    name: "助手",
    state: "running",
    kind: "expert",
    ...patch,
  }) as OctopAgent;
const msg = (patch: Partial<ChatMessage>): ChatMessage =>
  ({
    id: "m",
    role: "assistant",
    content: "hello",
    timestamp: 1,
    ...patch,
  }) as ChatMessage;

describe("private workbench", () => {
  it("allows local project previews only from loopback HTTP dashboards", () => {
    expect(supportsLocalProjectPreview("127.0.0.1", "http:")).toBe(true);
    expect(supportsLocalProjectPreview("localhost", "http:")).toBe(true);
    expect(supportsLocalProjectPreview("localhost", "https:")).toBe(false);
    expect(supportsLocalProjectPreview("octop.local", "http:")).toBe(false);
    expect(supportsLocalProjectPreview("192.168.1.10", "http:")).toBe(false);
  });

  it("routes all messages to a running team coordinator instead of a worker", () => {
    const worker = agent({ agent_id: "worker" });
    const stoppedTeam = agent({
      agent_id: "stopped",
      name: "team",
      kind: "team",
      member_ids: ["worker"],
      state: "stopped",
    });
    const team = agent({
      agent_id: "host",
      name: "主控",
      kind: "team",
      member_ids: ["worker"],
    });
    expect(selectPrimaryAgent([worker, stoppedTeam, team])?.agent_id).toBe(
      "host",
    );
    expect(canDelegate(team)).toBe(true);
    expect(canDelegate(worker)).toBe(false);
    expect(
      selectPrimaryAgent([worker, stoppedTeam, team], "host")?.agent_id,
    ).toBe("host");
    expect(
      selectPrimaryAgent([worker, stoppedTeam, team], "worker")?.agent_id,
    ).toBe("host");
    expect(selectPrimaryAgent([worker], "worker")?.agent_id).toBe("worker");
  });

  it("does not falsely advertise delegation for an empty or missing team", () => {
    expect(canDelegate(agent({ kind: "team", member_ids: [] }))).toBe(false);
    expect(selectPrimaryAgent([])).toBeNull();
  });

  it("renders only user/host chat messages, not worker or tool traces", () => {
    const items = [
      msg({ id: "1", role: "user", content: "帮我做个项目" }),
      msg({
        id: "2",
        role: "assistant",
        speakerAgentId: "worker",
        content: "worker result",
      }),
      msg({ id: "3", role: "tool", content: "tool log" }),
      msg({
        id: "4",
        role: "assistant",
        content: "主控汇总",
        teamWrapup: true,
      }),
      msg({
        id: "5",
        role: "assistant",
        content: "approval",
        hitlData: { action_requests: [] },
      }),
    ];
    expect(visibleConversationMessages(items, "host").map((m) => m.id)).toEqual(
      ["1", "3", "4"],
    );
  });

  it("preserves streaming process events and answer fragments for turn rendering", () => {
    const items = [
      msg({ id: "user-1", role: "user", content: "帮我检查一下" }),
      msg({ id: "reply-1", content: "我先检查当前工作区：" }),
      msg({ id: "tool-1", role: "tool", content: "命令输出" }),
      msg({
        id: "reply-2",
        content: "找到了原因。",
        status: "streaming",
      }),
      msg({ id: "user-2", role: "user", content: "继续修复" }),
      msg({ id: "reply-3", content: "开始处理。" }),
    ];

    expect(visibleConversationMessages(items, "host")).toMatchObject([
      { id: "user-1", content: "帮我检查一下" },
      { id: "reply-1", content: "我先检查当前工作区：" },
      { id: "tool-1", content: "命令输出" },
      { id: "reply-2", content: "找到了原因。", status: "streaming" },
      { id: "user-2", content: "继续修复" },
      { id: "reply-3", content: "开始处理。" },
    ]);
  });

  it("rejects script URLs, credentials and public or remote-hosted platforms", () => {
    expect(
      resolvePrivatePlatformUrl("javascript:alert(1)", "nas.local"),
    ).toBeNull();
    expect(
      resolvePrivatePlatformUrl("https://a:b@nas.local/", "nas.local"),
    ).toBeNull();
    expect(
      resolvePrivatePlatformUrl("https://external.example/", "nas.local"),
    ).toBeNull();
    expect(
      resolvePrivatePlatformUrl("http://nas.local:8130/app#x", "nas.local"),
    ).toBe("http://nas.local:8130/app");
    expect(
      resolvePrivatePlatformUrl(
        "http://nas.local:8130/",
        "nas.local",
        "https:",
      ),
    ).toBeNull();
    expect(
      resolvePrivatePlatformUrl(
        "https://nas.local:8130/",
        "nas.local",
        "https:",
      ),
    ).toBe("https://nas.local:8130/");
  });

  it("permits the managed project to cross between localhost loopback names", () => {
    expect(
      resolvePrivatePlatformUrl("http://127.0.0.1:8090/", "localhost"),
    ).toBe("http://127.0.0.1:8090/");
    expect(
      resolvePrivatePlatformUrl("http://192.168.1.10:8090/", "localhost"),
    ).toBeNull();
  });
});
