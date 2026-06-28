// One-shot probe: connects to the running host and prints the live state.
const ws = new WebSocket("ws://127.0.0.1:3700");
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "state") {
    const s = m.state;
    const active = s.setlist.filter((x) => x.active).length;
    const linked = s.setlist.filter((x) => x.linkedNext).length;
    console.log(`bridgeConnected: ${s.bridgeConnected} | bridgeVersion: ${s.bridgeVersion}`);
    console.log(`library: ${s.library.length} | setlist: ${s.setlist.length} (active ${active}, linked ${linked}) | currentEntry: ${s.currentEntryIndex}`);
    console.log("tracks:", JSON.stringify(s.tracks?.slice(0, 12)));
    console.log("settings:", JSON.stringify(s.settings));
    console.log("transport:", JSON.stringify(s.transport));
    process.exit(0);
  }
});
ws.addEventListener("error", () => { console.error("ws error"); process.exit(1); });
setTimeout(() => { console.error("no state received"); process.exit(1); }, 4000);
