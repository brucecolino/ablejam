// Mock bridge: emulates the Ableton control surface so host + UI can be tested
// without Live. Includes sections / colors / SONG END to exercise the parser.
import dgram from "node:dgram";
import { ADDR, PORTS } from "@ablejam/shared";
import { encode, decode } from "@ablejam/shared/osc";

const HOST = "127.0.0.1";
const sock = dgram.createSocket("udp4");

const cues = [
  { name: "QUOTES 1 [purple] {tape intro}", time: 0 },
  { name: "SONG END", time: 16 },
  { name: "INTRO KABAKA [green]", time: 24 },
  { name: "> Build", time: 40 },
  { name: "SONG END", time: 72 },
  { name: "HERE COMES TROUBLE [amber]", time: 80 },
  { name: "> Verse", time: 96 },
  { name: ">> Chorus", time: 128 },
  { name: "> Bridge +LOOPFULL", time: 160 },
  { name: "SONG END", time: 200 },
  { name: "CHASE THE DEVIL [red] [3:00]", time: 208 },
  { name: "SONG END", time: 300 },
  { name: "BAD BOYS", time: 312 },
  { name: "STOP", time: 360 },
  { name: "I'M STILL IN LOVE [teal]", time: 372 },
];

let isPlaying = false;
let time = 0;
const tempo = 154;

function send(address: string, args: (number | string)[] = []): void {
  sock.send(encode(address, args), PORTS.hostRecv, HOST);
}
function sendSetlist(): void {
  send(ADDR.setlist, [JSON.stringify(cues)]);
}
function sendTracks(): void {
  send(ADDR.tracks, [JSON.stringify(["Click", "Drums", "Bass", "Vocals", "Synth", "Emergency"])]);
}
function sendTransport(): void {
  send(ADDR.transport, [isPlaying ? 1 : 0, time, tempo, 4, 4, 0]);
}

sock.on("message", (msg) => {
  const { address, args } = decode(msg);
  switch (address) {
    case ADDR.cmdPlay: isPlaying = true; break;
    case ADDR.cmdPause: isPlaying = false; break;
    case ADDR.cmdStop: isPlaying = false; break;
    case ADDR.cmdJumpToTime: time = Number(args[0]); break;
    case ADDR.cmdFireClip: console.log("[mock] fire emergency clip on track:", args[0]); break;
    case ADDR.cmdRefresh: sendSetlist(); sendTracks(); break;
    default: break;
  }
});

sock.bind(PORTS.bridgeRecv, () => {
  console.log(`[mock] listening for commands on :${PORTS.bridgeRecv}`);
  send(ADDR.hello, ["mock bridge connected", 999]);
  sendSetlist();
  sendTracks();
});

setInterval(() => {
  if (isPlaying) time += (tempo / 60) * 0.1;
  sendTransport();
}, 100);
