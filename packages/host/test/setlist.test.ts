import assert from "node:assert/strict";
import { SetlistManager } from "../src/setlist";
import type { Song } from "@ablejam/shared";

let passed = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    console.error("FAIL  " + name + "\n  " + (e as Error).message);
    process.exitCode = 1;
  }
}

function song(title: string, start: number, end: number): Song {
  return { title, startBeat: start, endBeat: end, durationSec: (end - start) * 0.5, color: null, description: null, tags: [], isSong: true, stopAfter: false, continuesNext: false, sections: [] };
}
function lib(): Song[] {
  return [song("Buffalo Soldier", 0, 10), song("One Love", 10, 20), song("Get Up Stand Up", 20, 30), song("Is This Love", 30, 40)];
}

t("setLibrary -> all active, timeline order", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  assert.equal(m.entries.length, 4);
  assert.ok(m.entries.every((e) => e.active));
  assert.equal(m.currentEntry, -1);
});

t("jump target + current entry tracking with playhead", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.setCurrentEntry(2);
  assert.equal(m.jumpBeatForEntry(2), 20);
  m.syncFromPlayhead(2, false); // jump landed (stopped)
  assert.equal(m.currentEntry, 2);
  // Stopped: a stray playhead read must NOT move the user's selection (the bug fix).
  m.syncFromPlayhead(0, false);
  assert.equal(m.currentEntry, 2);
  // Playing: advances FORWARD one entry as playback crosses into the next song.
  m.syncFromPlayhead(3, true);
  assert.equal(m.currentEntry, 3);
  // Playing: a far/backward playhead (e.g. the cold-start roll) is IGNORED, selection stays.
  m.syncFromPlayhead(0, true);
  assert.equal(m.currentEntry, 3);
});

t("serialize/restore preserves medley + duplicates across a library rebuild", () => {
  const m = new SetlistManager();
  m.setLibrary([song("A", 0, 10), song("B", 10, 20), song("A", 20, 30)]); // A twice
  m.toggleLink(0); // entry 0 -> medley with entry 1
  const saved = m.serialize();
  // A structural change in Ableton rebuilds the library (beats shifted):
  m.setLibrary([song("A", 5, 15), song("B", 15, 25), song("A", 25, 35)]);
  m.restoreFromSession(saved);
  assert.equal(m.entries[0]!.linkedNext, true); // medley link preserved (was being lost)
  assert.equal(m.entries[0]!.libIndex, 0);
  assert.equal(m.entries[1]!.libIndex, 1);
  assert.equal(m.entries[2]!.libIndex, 2); // duplicate "A" mapped to the SECOND occurrence
});

t("medleyStartEntry finds the first song of the medley", () => {
  const m = new SetlistManager();
  m.setLibrary(lib()); // 4 songs
  m.toggleLink(0); // 0 -> 1
  m.toggleLink(1); // 1 -> 2 (medley spans entries 0,1,2)
  assert.equal(m.medleyStartEntry(2), 0); // from the 3rd medley song, back to the 1st
  assert.equal(m.medleyStartEntry(1), 0);
  assert.equal(m.medleyStartEntry(0), 0);
  assert.equal(m.medleyStartEntry(3), 3); // standalone song -> itself
});

t("reorder moves entries", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.reorder(0, 2); // move Buffalo Soldier down
  assert.deepEqual(m.entries.map((e) => e.libIndex), [1, 2, 0, 3]);
});

t("setActive + nextActiveAfter skips removed", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.setActive(1, false);
  assert.equal(m.nextActiveAfter(0), 2);
  assert.equal(m.prevActiveBefore(3), 2);
});

t("applyTitles fuzzy-matches and orders; unmatched appended removed", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  const r = m.applyTitles(["get up stand up", "buffalo"]);
  assert.equal(r.matched, 2);
  assert.equal(m.entries[0]!.libIndex, 2); // Get Up Stand Up
  assert.equal(m.entries[1]!.libIndex, 0); // Buffalo Soldier
  assert.ok(m.entries[0]!.active && m.entries[1]!.active);
  // remaining songs (One Love, Is This Love) appended as removed
  const removed = m.entries.filter((e) => !e.active).map((e) => e.libIndex).sort();
  assert.deepEqual(removed, [1, 3]);
});

t("applyTitles reports unmatched", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  const r = m.applyTitles(["one love", "totally unknown zzz"]);
  assert.equal(r.matched, 1);
  assert.deepEqual(r.unmatched, ["totally unknown zzz"]);
});

t("applyTitles ignores pure-number / date / noise lines", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  const r = m.applyTitles(["1", "One Love", "25/06/2025", "2", "Buffalo Soldier"]);
  assert.equal(r.matched, 2);
  assert.equal(r.total, 2); // only the two real title lines counted
  assert.equal(m.entries[0]!.libIndex, 1); // One Love
  assert.equal(m.entries[1]!.libIndex, 0); // Buffalo Soldier
});

t("import: medley split + START SEQ grouping + key", () => {
  const m = new SetlistManager();
  m.setLibrary([song("Come Around", 0, 10), song("Get Up Stand Up", 10, 20), song("One Love", 20, 30), song("Is This Love", 30, 40)]);
  const r = m.applyTitles([
    "COME AROUND (F#m) [START SEQ]",
    "GET UP STAND UP / ONE LOVE (Am)", // continues (no START SEQ) -> same medley; "/" links the two
    "IS THIS LOVE (Em) [START SEQ]", // new start -> not linked
  ], true); // linkMedleys = on (this case verifies the GROUPING path, not the split default)
  assert.equal(r.matched, 4);
  assert.equal(m.entries[0]!.linkedNext, true);
  assert.equal(m.entries[1]!.linkedNext, true);
  assert.equal(m.entries[2]!.linkedNext, false);
  assert.equal(m.entries[3]!.linkedNext, false);
  assert.equal(m.entries[0]!.key, "F#m");
  assert.equal(m.entries[1]!.key, "Am");
});

t("import dedups consecutive same-song matches", () => {
  const m = new SetlistManager();
  m.setLibrary([song("World A Reggae - Welcome To Jamrock", 0, 10), song("Bun Dem", 10, 20)]);
  // both parts of line 1 fuzzy-match the same library song -> only one entry
  const r = m.applyTitles(["WORLD A REGGAE / JAMROCK (F#m) [START SEQ]", "BUN DEM (F#m)"]);
  const active = m.entries.filter((e) => e.active);
  assert.equal(active.length, 2);
  assert.equal(active[0]!.libIndex, 0);
  assert.equal(active[1]!.libIndex, 1);
  void r;
});

t("undo/redo restores and re-applies an edit", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.pushHistory(); m.reorder(0, 2); // -> [1,2,0,3]
  assert.deepEqual(m.entries.map((e) => e.libIndex), [1, 2, 0, 3]);
  assert.ok(m.canUndo());
  m.undo();
  assert.deepEqual(m.entries.map((e) => e.libIndex), [0, 1, 2, 3]); // back to original
  assert.ok(m.canRedo());
  m.redo();
  assert.deepEqual(m.entries.map((e) => e.libIndex), [1, 2, 0, 3]); // edit re-applied
});

t("a new edit clears the redo branch", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.pushHistory(); m.reorder(0, 1);
  m.undo();
  assert.ok(m.canRedo());
  m.pushHistory(); m.setActive(0, false); // a fresh edit
  assert.ok(!m.canRedo()); // redo branch dropped
});

t("undo history is capped at 10", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  for (let i = 0; i < 15; i++) { m.pushHistory(); m.setActive(0, i % 2 === 0); }
  let n = 0;
  while (m.undo()) n++;
  assert.equal(n, 10); // older snapshots beyond 10 were dropped
});

t("loading a new library clears undo history", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.pushHistory(); m.reorder(0, 2);
  assert.ok(m.canUndo());
  m.setLibrary(lib()); // rebuild -> stale snapshots dropped
  assert.ok(!m.canUndo());
});

t("undo snapshot is deep-copied (a later mutation doesn't leak in)", () => {
  const m = new SetlistManager();
  m.setLibrary(lib());
  m.pushHistory();
  m.setEntryColor(0, "#ff0000");
  m.undo();
  assert.equal(m.entries[0]!.color, undefined); // snapshot pre-dates the colour and stayed intact
});

console.log(`\n${passed} checks passed`);
