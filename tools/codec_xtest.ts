import { readFileSync, writeFileSync } from "node:fs";
import { encode, decode } from "../packages/shared/src/osc.ts";

const mode = process.argv[2];
const path = process.argv[3];

if (mode === "decode" && path) {
  const buf = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  const m = decode(buf);
  console.log("JS decode:", m.address, m.args);
  if (m.address !== "/ablejam/transport") throw new Error("bad address");
  if (m.args[0] !== 1 || Math.abs((m.args[1] as number) - 154.5) > 1e-3 || m.args[4] !== 3) {
    throw new Error("bad args " + JSON.stringify(m.args));
  }
  console.log("PASS  node decoded the python-encoded transport");

  // Emit a command for python to decode (the other direction).
  writeFileSync("tools/node_msg.hex", encode("/ablejam/cmd/jumpToSong", [3]).toString("hex"));
}
