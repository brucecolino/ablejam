// Demo mode data: a fictional setlist + the values a simulated "bridge" feeds the host, so a
// new user can practice the whole app (navigate, Performance/Stage, follow the playhead)
// without Ableton. Same cue/marker format the real control surface sends.
export const DEMO_TEMPO = 120;
export const DEMO_BRIDGE_VERSION = 1000; // sentinel shown next to the "Live" dot while in demo

// Locator markers (beats). Song titles carry a (Key), a [color] and sometimes {a note}; "> X"
// is a section, ">> X" a quick section, trailing "/" chains a medley, SONG END / STOP end a song.
export const DEMO_CUES: { name: string; time: number }[] = [
  { name: "WELCOME TO ABLEJAM (C) [green] {prova: Play, Avanti, Indietro}", time: 0 },
  { name: "> Intro", time: 16 },
  { name: "> Verse", time: 32 },
  { name: "SONG END", time: 60 },
  { name: "SUNRISE SKA (Am) [amber]", time: 68 },
  { name: "> Verse", time: 84 },
  { name: ">> Chorus", time: 100 },
  { name: "SONG END", time: 132 },
  { name: "MIDNIGHT DUB (Dm) [purple]", time: 140 },
  { name: "STOP", time: 188 },
  { name: "RIVER ROOTS (G) [teal] /", time: 196 },
  { name: "MOUNTAIN HIGH (G) [teal] /", time: 236 },
  { name: "OCEAN WIDE (G) [teal]", time: 276 },
  { name: "SONG END", time: 316 },
  { name: "GOLDEN HOUR (F) [red]", time: 324 },
  { name: "SONG END", time: 372 },
  { name: "LAST CALL (Em) [blue]", time: 380 },
];

export const DEMO_TRACKS = ["Click", "Drums", "Bass", "Keys", "Vocals", "LYRICS", "Emergency"];
