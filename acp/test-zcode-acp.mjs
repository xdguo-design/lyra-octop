import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["D:/WorkSpace/octop-src/acp/zcode-acp.mjs"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const waiting = new Map();
let nextId = 1;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method === "session/update") {
      process.stdout.write("[chunk] " + JSON.stringify(msg.params.update.content?.text ?? "").slice(0, 120) + "\n");
    }
  }
});
function call(method, params) {
  const id = nextId++;
  return new Promise((res) => {
    waiting.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const init = await call("initialize", { protocolVersion: 1, clientInfo: { name: "test", version: "0" } });
console.log("init =>", JSON.stringify(init.result));
if (init.result?.protocolVersion !== 1) { console.log("PROTOCOL MISMATCH"); process.exit(1); }
const sess = await call("session/new", { cwd: "D:/WorkSpace/lyra-planet" });
console.log("new =>", JSON.stringify(sess.result));
const t0 = Date.now();
const pr = await call("session/prompt", { sessionId: sess.result.sessionId, prompt: [{ type: "text", text: "只回复两个字：好的" }] });
console.log("prompt =>", JSON.stringify(pr.result), "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
await call("session/close", { sessionId: sess.result.sessionId });
child.kill();
process.exit(0);
