/**
 * 用无头 Edge 给控制台截图（走 CDP，无第三方依赖）。
 *
 * 用法：
 *   node scripts/screenshot.mjs overview=/ knowledge=/knowledge review=/review
 *   SHOT_ORIGIN=http://127.0.0.1:33005 node scripts/screenshot.mjs overview=/
 *   SHOT_ONBOARD=1 node scripts/screenshot.mjs onboarding=/     # 让新手引导保持打开
 *   SHOT_W=1440 SHOT_H=900 node scripts/screenshot.mjs wide=/   # 自定义视口
 *
 * 输出目录：截图默认写到 <repo>/.screenshots/
 * 前置条件：Windows + Edge（默认路径见 EDGE 常量），目标站点已启动。
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const EDGE =
  process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SHOT_OUT ?? resolve(REPO_ROOT, ".screenshots");
const PROFILE = resolve(OUT, ".edge-profile");
const PORT = Number(process.env.SHOT_PORT ?? 9444);
const ORIGIN = process.env.SHOT_ORIGIN ?? "http://127.0.0.1:33005";
const WIDTH = Number(process.env.SHOT_W ?? 1680);
const HEIGHT = Number(process.env.SHOT_H ?? 1050);

const routes = process.argv.slice(2).map((arg) => {
  const [name, path] = arg.split("=");
  return [name, path ?? "/"];
});

if (routes.length === 0) {
  console.error("usage: node scripts/screenshot.mjs name=/path [name2=/path2 ...]");
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const edge = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ready = false;
for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
  try {
    ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
  } catch {
    /* 还在启动 */
  }
  if (!ready) await sleep(250);
}
if (!ready) {
  console.error("Edge 没有暴露调试端口，检查 EDGE_PATH");
  edge.kill();
  process.exit(1);
}

const target = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  ws.addEventListener("open", resolveOpen, { once: true });
  ws.addEventListener("error", rejectOpen, { once: true });
});

let messageId = 0;
const pending = new Map();
const problems = [];

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolveMessage, rejectMessage } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectMessage(new Error(JSON.stringify(message.error)));
    else resolveMessage(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    problems.push(`EXCEPTION ${message.params.exceptionDetails.exception?.description ?? ""}`);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    problems.push(
      `console.error ${message.params.args.map((a) => a.value ?? a.description).join(" ")}`,
    );
  }
});

function send(method, params = {}) {
  messageId += 1;
  const id = messageId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveMessage, rejectMessage) => {
    pending.set(id, { resolveMessage, rejectMessage });
    setTimeout(() => rejectMessage(new Error(`timeout: ${method}`)), 30_000);
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});

// 先访问一次，写入引导状态，避免首次打开的向导挡住截图
await send("Page.navigate", { url: `${ORIGIN}/` });
await sleep(2200);
const onboardingState =
  process.env.SHOT_ONBOARD === "1"
    ? `{completed:[],dismissed:false}`
    : `{completed:[0,1,2,3,4],dismissed:true}`;
await send("Runtime.evaluate", {
  expression: `localStorage.setItem("ledger-onboarding-v1", JSON.stringify(${onboardingState}))`,
});

for (const [name, path] of routes) {
  await send("Page.navigate", { url: `${ORIGIN}${path}` });
  await sleep(2400);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(resolve(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
  console.log(`saved ${name}.png  <- ${path}`);
}

if (problems.length > 0) console.log("console issues:", problems.slice(0, 8));

ws.close();
edge.kill();
process.exit(0);
