// M2 smoke test: boots host + mock bridge, exercises the new features over
// WebSocket, asserts, then tears down. Node 24 (global WebSocket).
import { spawn } from "node:child_process";

const root = process.cwd();
const children = [];
function boot(script) {
  const c = spawn("pnpm", ["--filter", "@ablejam/host", "run", script], { cwd: root, shell: true, stdio: ["ignore", "ignore", "inherit"] });
  children.push(c);
  return c;
}
function cleanup() {
  for (const c of children) if (c.pid) { try { spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { shell: true }); } catch {} }
}

const results = [];
const check = (n, ok) => { results.push([n, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;
let importResult = null;
function onMsg(m) {
  if (m.type === "state") state = m.state;
  else if (m.type === "transport" && state) { state.transport = m.transport; state.currentEntryIndex = m.currentEntryIndex; state.bridgeConnected = m.bridgeConnected; }
  else if (m.type === "importResult") importResult = m.result;
}

async function main() {
  boot("start");
  boot("mock");
  await sleep(2800);

  const ws = new WebSocket("ws://127.0.0.1:3700");
  ws.addEventListener("message", (e) => onMsg(JSON.parse(e.data)));
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", () => rej(new Error("ws connection failed")));
    setTimeout(() => rej(new Error("ws open timeout")), 5000);
  });
  const send = (c) => ws.send(JSON.stringify(c));
  await sleep(500);

  check("bridge version reported", state?.bridgeVersion === 999);
  check("tracks received", (state?.tracks?.length ?? 0) >= 4);
  check("library + setlist built", state?.library?.length === 6 && state?.setlist?.length === 6);

  send({ type: "command", command: "toggleLink", index: 0 });
  await sleep(250);
  check("toggleLink sets linkedNext (medley)", state?.setlist?.[0]?.linkedNext === true);

  send({ type: "command", command: "setSetting", key: "autoContinue", value: true });
  await sleep(250);
  check("setSetting boolean", state?.settings?.autoContinue === true);

  send({ type: "command", command: "setSetting", key: "emergencyTrack", value: "Emergency" });
  await sleep(250);
  check("setSetting string (emergency track)", state?.settings?.emergencyTrack === "Emergency");

  send({ type: "command", command: "jumpToEntry", index: 3 });
  await sleep(450);
  check("jumpToEntry -> currentEntryIndex 3", state?.currentEntryIndex === 3);

  send({ type: "command", command: "play" });
  await sleep(500);
  check("play -> isPlaying", state?.transport?.isPlaying === true);

  send({ type: "command", command: "importText", text: "HERE COMES TROUBLE\n1. QUOTES 1\n42" });
  await sleep(450);
  check("import matched 2 (numbers ignored)", importResult?.matched === 2 && importResult?.total === 2);
  check("import reordered first song", state?.library?.[state.setlist[0].libIndex]?.title === "HERE COMES TROUBLE");

  send({ type: "command", command: "stop" });
  await sleep(300);
  check("stop -> not playing", state?.transport?.isPlaying === false);

  ws.close();
}

const watchdog = setTimeout(() => { console.error("TIMEOUT"); cleanup(); process.exit(1); }, 18000);
main()
  .then(() => {
    clearTimeout(watchdog);
    cleanup();
    const failed = results.filter(([, o]) => !o).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
  })
  .catch((e) => {
    clearTimeout(watchdog);
    console.error("ERROR:", e.message);
    cleanup();
    setTimeout(() => process.exit(1), 300);
  });
