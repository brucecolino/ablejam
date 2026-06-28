import assert from "node:assert/strict";
import { parseLocator, buildSetlist, locateCurrent, bestMatch, matchScore, normalizeTitle, stripListMarker } from "../src/index";

let passed = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("  " + (e as Error).message);
    process.exitCode = 1;
  }
}

t("plain song", () => {
  const p = parseLocator("Buffalo Soldier");
  assert.equal(p.title, "Buffalo Soldier");
  assert.equal(p.section, null);
  assert.equal(p.marker, null);
});

t("section and quick section", () => {
  assert.equal(parseLocator("> Verse 2").section, "section");
  assert.equal(parseLocator("> Verse 2").title, "Verse 2");
  assert.equal(parseLocator(">> Chorus").section, "quickSection");
  assert.equal(parseLocator(">> Chorus").title, "Chorus");
});

t("medley `/` prefix and suffix mark a song as continuing", () => {
  // prefix: this song continues FROM the previous
  const pre = parseLocator("/ Come Around");
  assert.equal(pre.medleyPrefix, true);
  assert.equal(pre.title, "Come Around"); // slash stripped from the title
  // suffix: this song continues INTO the next
  const suf = parseLocator("Come Around /");
  assert.equal(suf.medleyNext, true);
  assert.equal(suf.title, "Come Around"); // trailing slash stripped
  assert.equal(parseLocator("Blessings").medleyNext, false);
  assert.equal(parseLocator("AC/DC").medleyNext, false); // internal slash is not a marker

  // SUFFIX convention (what the user uses): "X /" -> X continues into the next.
  const a = buildSetlist([
    { name: "Blessings", time: 0 },
    { name: "Come Around /", time: 16 },
    { name: "Kingston Town /", time: 32 },
    { name: "Herbalist", time: 48 },
  ], 120);
  assert.equal(a[0]!.continuesNext, false); // Blessings standalone
  assert.equal(a[1]!.continuesNext, true);  // Come Around -> Kingston (medley)
  assert.equal(a[2]!.continuesNext, true);  // Kingston -> Herbalist (medley)
  assert.equal(a[3]!.continuesNext, false); // Herbalist ends the medley
  assert.equal(a[1]!.title, "Come Around"); // title cleaned

  // PREFIX convention still works: "/ X" -> the PREVIOUS song continues into X.
  const b = buildSetlist([
    { name: "Blessings", time: 0 },
    { name: "/ Come Around", time: 16 },
  ], 120);
  assert.equal(b[0]!.continuesNext, true);
});

t("musical key in parens comes from the marker (before any /)", () => {
  const a = parseLocator("Buffalo Soldier (Am)");
  assert.equal(a.title, "Buffalo Soldier");
  assert.equal(a.key, "Am");
  const m = parseLocator("Get Busy (Fm) /");
  assert.equal(m.title, "Get Busy");
  assert.equal(m.key, "Fm");
  assert.equal(m.medleyNext, true);
  assert.equal(parseLocator("Is This Love (Em-Am)").key, "Em-Am");
  assert.equal(parseLocator("F#m test (F#m)").key, "F#m");
  // a non-key parenthetical stays in the title
  assert.equal(parseLocator("Interlude (Live)").key, null);
  assert.equal(parseLocator("Interlude (Live)").title, "Interlude (Live)");
});

t("markers", () => {
  assert.equal(parseLocator("SONG END").marker, "songEnd");
  assert.equal(parseLocator("STOP").marker, "stop");
  assert.equal(parseLocator("AUTOSTOP").marker, "stop");
});

t("ignored and dot prefix", () => {
  assert.equal(parseLocator("*band enters").ignored, true);
  assert.equal(parseLocator(". Follow Night").dotPrefix, true);
  assert.equal(parseLocator(". Follow Night").title, "Follow Night");
});

t("color, description, duration, tags, class", () => {
  const p = parseLocator("Galvanize [blue] {Tuning: C} [3:20] #rock #set1 [.bold]");
  assert.equal(p.color, "blue");
  assert.equal(p.description, "Tuning: C");
  assert.equal(p.durationSec, 200);
  assert.deepEqual(p.tags, ["rock", "set1"]);
  assert.equal(p.className, "bold");
  assert.equal(p.title, "Galvanize");
});

t("nosong", () => {
  const p = parseLocator("Interlude [nosong]");
  assert.equal(p.nosong, true);
  assert.equal(p.title, "Interlude");
});

t("flags with count", () => {
  const p = parseLocator("> Bridge +LOOPFULL:4 +GUIDE");
  assert.deepEqual(p.flags, [{ name: "LOOPFULL", count: 4 }, { name: "GUIDE" }]);
  assert.equal(p.title, "Bridge");
});

t("transition", () => {
  const p = parseLocator("> Intro >>> Verse 1");
  assert.equal(p.section, "section");
  assert.equal(p.title, "Intro");
  assert.equal(p.transitionTarget, "Verse 1");
});

t("buildSetlist groups sections and computes ends", () => {
  const songs = buildSetlist(
    [
      { name: "Song A [red]", time: 0 },
      { name: "> Verse", time: 8 },
      { name: ">> Chorus", time: 24 },
      { name: "SONG END", time: 56 },
      { name: "Song B", time: 64 },
      { name: "STOP", time: 120 },
    ],
    120,
  );
  assert.equal(songs.length, 2);
  assert.equal(songs[0]!.title, "Song A");
  assert.equal(songs[0]!.color, "red");
  assert.equal(songs[0]!.sections.length, 2);
  assert.equal(songs[0]!.endBeat, 56);
  assert.equal(songs[0]!.durationSec, 28); // 56 beats @120bpm = 28s
  assert.equal(songs[1]!.stopAfter, true);
  assert.equal(songs[1]!.endBeat, 120);
});

t("locateCurrent finds song and section", () => {
  const songs = buildSetlist(
    [
      { name: "Song A", time: 0 },
      { name: "> Verse", time: 8 },
      { name: "> Chorus", time: 24 },
      { name: "Song B", time: 64 },
    ],
    120,
  );
  assert.deepEqual(locateCurrent(songs, 30), { songIndex: 0, sectionIndex: 1 });
  assert.deepEqual(locateCurrent(songs, 70), { songIndex: 1, sectionIndex: -1 });
  assert.deepEqual(locateCurrent(songs, -5), { songIndex: -1, sectionIndex: -1 });
});

t("dot prefix stops previous song", () => {
  const songs = buildSetlist(
    [
      { name: "Song A", time: 0 },
      { name: ". Song B", time: 32 },
    ],
    120,
  );
  assert.equal(songs[0]!.stopAfter, true);
});

// ---- fuzzy matcher ----

const LIB = [
  "QUOTES 1", "INTRO KABAKA", "HERE COMES TROUBLE", "BUFFALO SOLDIER",
  "COULD YOU BE LOVED", "GET UP STAND UP", "ONE LOVE", "IS THIS LOVE",
  "GET BUSY", "REDEMPTION SONG", "WORLD A REGGAE - WELCOME TO JAMROCK",
];

t("normalize strips case, accents, punctuation", () => {
  assert.equal(normalizeTitle("  Rédemption, Song!  "), "redemption song");
});

t("exact and case-insensitive match", () => {
  assert.equal(bestMatch("buffalo soldier", LIB)?.index, 3);
  assert.equal(bestMatch("ONE LOVE", LIB)?.index, 6);
});

t("partial title matches", () => {
  assert.equal(bestMatch("buffalo", LIB)?.index, 3);
  assert.equal(bestMatch("welcome to jamrock", LIB)?.index, 10);
});

t("acronym matches", () => {
  assert.equal(bestMatch("GUSU", LIB)?.index, 5); // Get Up Stand Up
});

t("typo tolerated, picks best", () => {
  assert.equal(bestMatch("redemtion song", LIB)?.index, 9);
});

t("no false positive below threshold", () => {
  assert.equal(bestMatch("zzz totally unrelated xyz", LIB), null);
});

t("disambiguates love songs", () => {
  assert.equal(bestMatch("could you be loved", LIB)?.index, 4);
  assert.equal(bestMatch("is this love", LIB)?.index, 7);
});

t("strip list markers", () => {
  assert.equal(stripListMarker("1. One Love"), "One Love");
  assert.equal(stripListMarker("12) Get Busy"), "Get Busy");
  assert.equal(stripListMarker("- Buffalo Soldier"), "Buffalo Soldier");
});

void matchScore;

console.log(`\n${passed} checks passed`);
