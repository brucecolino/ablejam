import { type SetlistEntry, type Song, bestMatch, normalizeTitle, stripListMarker, schemeHex } from "@ablejam/shared";

/**
 * Owns the performance setlist: an ordered list of entries referencing songs in
 * the library. Navigation follows setlist order (not the Live timeline). The
 * "current entry" is tracked explicitly and reconciled with the playhead.
 */
export class SetlistManager {
  library: Song[] = [];
  entries: SetlistEntry[] = [];
  currentEntry = -1;
  /** True while medleys are auto-derived from the project's stop notes (the default on a
   * fresh project / "↺ Originale"). Any manual medley/order edit or explicit import/load
   * turns it off, so the user's choices are never overwritten. */
  medleysAreAuto = true;

  private lastLibIndex = -1;
  private awaitTargetLib: number | null = null;
  private awaitTicks = 0;
  // Editor undo/redo: snapshots of the working order (entries + medley-auto flag), capped at 10.
  private undoStack: { entries: SetlistEntry[]; medleysAreAuto: boolean }[] = [];
  private redoStack: { entries: SetlistEntry[]; medleysAreAuto: boolean }[] = [];
  private static readonly HISTORY_MAX = 10;

  /** New repertoire — reset the setlist to all songs in timeline order. */
  setLibrary(lib: Song[]): void {
    this.library = lib;
    this.entries = lib.map((_, i) => ({ libIndex: i, active: true, linkedNext: false, key: "" }));
    this.currentEntry = -1;
    this.awaitTargetLib = null;
    this.clearHistory();
  }

  /** Same repertoire (e.g. tempo rebuild) — keep edits, just refresh song data. */
  refreshLibrary(lib: Song[]): void {
    this.library = lib;
    this.entries = this.entries.filter((e) => e.libIndex < lib.length);
    this.clearHistory(); // entries reference libIndex into the rebuilt library — old snapshots are stale
  }

  songOf(i: number): Song | undefined {
    const e = this.entries[i];
    return e ? this.library[e.libIndex] : undefined;
  }

  jumpBeatForEntry(i: number): number | null {
    const s = this.songOf(i);
    return s ? s.startBeat : null;
  }

  setCurrentEntry(i: number): void {
    this.currentEntry = i;
    const e = this.entries[i];
    this.awaitTargetLib = e ? e.libIndex : null;
    this.awaitTicks = 0;
  }

  nextActiveAfter(i: number): number {
    for (let k = i + 1; k < this.entries.length; k++) if (this.entries[k]!.active) return k;
    return -1;
  }
  prevActiveBefore(i: number): number {
    for (let k = i - 1; k >= 0; k--) if (this.entries[k]!.active) return k;
    return -1;
  }
  firstActive(): number {
    return this.entries.findIndex((e) => e.active);
  }
  /** First entry of the medley group containing i (walk back while the previous entry
   * links into this one). Returns i itself when it is not inside a medley. */
  medleyStartEntry(i: number): number {
    if (i < 0) return i;
    let start = i;
    while (start > 0 && this.entries[start - 1]?.linkedNext) start--;
    return start;
  }

  /** Reconcile the current entry with the playhead. The user's selection is
   * AUTHORITATIVE: while stopped we never move it; while playing we only advance it
   * forward, one setlist entry at a time, as playback crosses into the next song.
   * (The old "derive nearest library index every tick" was hopelessly unreliable once
   * the setlist is reordered vs the timeline and/or contains duplicate songs — the
   * playhead would yank the current entry to a different row, breaking Prev/Next/Play.) */
  syncFromPlayhead(libIndex: number, isPlaying: boolean): void {
    this.lastLibIndex = libIndex;
    // Honor an in-flight jump until the playhead reaches the target song.
    if (this.awaitTargetLib != null) {
      if (libIndex === this.awaitTargetLib) { this.awaitTargetLib = null; this.awaitTicks = 0; }
      else if (++this.awaitTicks <= 25) return; // wait (~2.5s) for the jump to land
      else this.awaitTargetLib = null;
    }
    const cur = this.entries[this.currentEntry];
    // Initialize once if there is no valid current entry yet.
    if (!cur || !cur.active) { this.deriveFromPlayhead(libIndex); return; }
    // Stopped: the user's selection wins outright — never re-derive from the playhead.
    if (!isPlaying) return;
    // Playing and still inside the current song: keep it.
    if (cur.libIndex === libIndex) return;
    // Playing and the playhead moved on: advance to the NEXT active entry ONLY if the
    // playhead is now in its song (normal forward / medley progression).
    const next = this.nextActiveAfter(this.currentEntry);
    if (next >= 0 && this.entries[next]!.libIndex === libIndex) { this.currentEntry = next; return; }
    // Anything else (the brief cold-start roll to a stale position, or a far/backward
    // playhead): KEEP the current selection. We must NEVER derive a far/duplicate entry
    // from a transient playhead — that was the on-screen "wrong song" flash. The shown
    // song only changes via explicit navigation or natural one-step forward progression.
  }

  /** The entry that best matches the playhead's song — nearest ACTIVE occurrence to the current
   * selection — WITHOUT touching the selection (read-only twin of deriveFromPlayhead). `ambiguous`
   * flags duplicate occurrences that DISAGREE on linkedNext: the caller must then never arm a stop
   * (mid-medley, continuing on a doubt is safe; stopping is not). Used by the auto-stop logic so a
   * misaligned currentEntry (setlist rebuild, duplicates) can't arm a stop on a linked medley. */
  entryAtPlayhead(libIndex: number): { index: number; ambiguous: boolean } {
    let best = -1;
    let bestDist = Infinity;
    let sawLinked = false;
    let sawUnlinked = false;
    if (libIndex >= 0) {
      this.entries.forEach((e, i) => {
        if (!e.active || e.libIndex !== libIndex) return;
        if (e.linkedNext) sawLinked = true; else sawUnlinked = true;
        const d = this.currentEntry >= 0 ? Math.abs(i - this.currentEntry) : i;
        if (d < bestDist) { bestDist = d; best = i; }
      });
    }
    return { index: best, ambiguous: sawLinked && sawUnlinked };
  }

  private deriveFromPlayhead(libIndex: number): void {
    let best = -1;
    if (libIndex >= 0) {
      let bestDist = Infinity;
      this.entries.forEach((e, i) => {
        if (e.active && e.libIndex === libIndex) {
          const d = this.currentEntry >= 0 ? Math.abs(i - this.currentEntry) : i;
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
      });
    }
    if (best >= 0) {
      this.currentEntry = best;
      return;
    }
    // Playhead isn't on an active song: keep a valid current, else default to the
    // first active song so the Performance view always shows something.
    const cur = this.entries[this.currentEntry];
    if (!cur || !cur.active) this.currentEntry = this.firstActive();
  }

  private recompute(): void {
    if (this.lastLibIndex >= 0) this.deriveFromPlayhead(this.lastLibIndex);
    else if (this.currentEntry >= this.entries.length) this.currentEntry = -1;
  }

  // ---- undo / redo (manual editor edits only; a bulk load/import/rebuild clears the history) ----
  private snapshot(): { entries: SetlistEntry[]; medleysAreAuto: boolean } {
    return { entries: this.entries.map((e) => ({ ...e })), medleysAreAuto: this.medleysAreAuto };
  }
  /** Record the current state BEFORE a mutating edit (cap HISTORY_MAX); clears the redo branch. */
  pushHistory(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > SetlistManager.HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
  }
  clearHistory(): void { this.undoStack = []; this.redoStack = []; }
  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot());
    this.entries = prev.entries;
    this.medleysAreAuto = prev.medleysAreAuto;
    this.recompute();
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.entries = next.entries;
    this.medleysAreAuto = next.medleysAreAuto;
    this.recompute();
    return true;
  }

  // ---- editor operations ----
  reorder(from: number, to: number): void {
    if (from < 0 || from >= this.entries.length) return;
    const [m] = this.entries.splice(from, 1);
    if (!m) return;
    this.entries.splice(Math.max(0, Math.min(this.entries.length, to)), 0, m);
    this.medleysAreAuto = false;
    this.recompute();
  }
  /** Move a contiguous block of `count` entries (e.g. a whole medley) starting at `from` to
   * position `to`, keeping their internal order. */
  moveBlock(from: number, count: number, to: number): void {
    const n = this.entries.length;
    if (from < 0 || count < 1 || from + count > n) return;
    if (to >= from && to < from + count) return; // dropping inside itself — no-op
    const block = this.entries.splice(from, count);
    let target = to > from ? to - count : to; // removed items before the target shift it left
    target = Math.max(0, Math.min(this.entries.length, target));
    this.entries.splice(target, 0, ...block);
    this.medleysAreAuto = false;
    this.recompute();
  }
  setActive(i: number, active: boolean): void {
    const e = this.entries[i];
    if (e) e.active = active;
    this.medleysAreAuto = false;
    this.recompute();
  }
  toggleLink(index: number): void {
    const e = this.entries[index];
    if (e) e.linkedNext = !e.linkedNext;
    this.medleysAreAuto = false;
  }
  /** Derive medleys from the locator names: a song flows into the next (linked) when the
   * NEXT locator is marked with a `-` prefix (Song.continuesNext). Explicit and exact —
   * no guessing. Only runs while medleysAreAuto (never overrides the user's manual edits). */
  autoDetectMedleys(): void {
    if (!this.medleysAreAuto) return;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      const s = this.library[e.libIndex];
      const next = this.entries[i + 1];
      e.linkedNext = !!(s && next && s.continuesNext);
    }
  }
  setEntryColor(index: number, color: string): void {
    const e = this.entries[index];
    if (e) e.color = color || undefined;
  }
  /** Auto-colour the setlist: each medley group (a linkedNext chain) and each standalone
   * song becomes one performance unit and gets a distinct scheme colour — so a medley's
   * songs share one colour, separate songs differ. */
  autoColor(scheme: string): void {
    // Number the performance UNITS among ACTIVE entries only (a medley chain = one unit), so the
    // colour spread uses the real song count — NOT the removed/inactive entries that applyTitles
    // appends after an import (those would balloon the denominator and squash the whole palette
    // into one near-identical shade).
    const groupOf: number[] = [];
    let g = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (!e.active) { groupOf[i] = -1; continue; } // skip removed entries (they aren't shown)
      groupOf[i] = g;
      if (!e.linkedNext) g++; // unit ends where the medley chain stops linking
    }
    const total = Math.max(1, g);
    this.entries.forEach((e, i) => { if (groupOf[i]! >= 0) e.color = schemeHex(scheme, groupOf[i]!, total); });
  }

  addSong(libIndex: number, at?: number): void {
    if (libIndex < 0 || libIndex >= this.library.length) return;
    const entry: SetlistEntry = { libIndex, active: true, linkedNext: false, key: "" };
    if (at == null || at < 0 || at > this.entries.length) this.entries.push(entry);
    else this.entries.splice(at, 0, entry);
    this.medleysAreAuto = false;
    this.recompute();
  }
  clear(): void {
    this.entries.forEach((e) => (e.active = false));
    this.medleysAreAuto = false;
    this.recompute();
  }
  addAll(): void {
    this.entries.forEach((e) => (e.active = true));
    this.recompute();
  }
  resetToTimeline(): void {
    this.entries = this.library.map((_, i) => ({ libIndex: i, active: true, linkedNext: false, key: "" }));
    this.medleysAreAuto = true; // back to the project default -> re-derive medleys
    this.recompute();
  }
  sortAZ(): void {
    this.entries.sort((a, b) => (this.library[a.libIndex]?.title ?? "").localeCompare(this.library[b.libIndex]?.title ?? ""));
    this.medleysAreAuto = false;
    this.recompute();
  }

  /** Active song titles in order — used for save/copy. */
  activeTitles(): string[] {
    return this.entries.filter((e) => e.active).map((e) => this.library[e.libIndex]?.title ?? "");
  }

  /** Build the setlist from a list of titles (import/load), fuzzy-matched to the
   * library. Unmatched library songs are appended as removed (restorable). */
  /** Parse one imported line into medley parts + key + a "start sequence" flag. */
  private parseImportLine(raw: string): { hasSeq: boolean; key: string; parts: string[] } | null {
    let line = stripListMarker(raw).trim();
    if (!line) return null;
    // Skip AbleJam's own print header ("35 voci · 08/07/2026" and friends) so a printed setlist
    // re-imports cleanly instead of counting the header as a phantom title.
    if (/^\d+\s+(voci|voce|entries|entry|songs?|morceaux|canci[oó]n(?:es)?)\b/i.test(line)) return null;
    if (/^setlist(\s*\d.*)?$/i.test(line)) return null; // AbleJam export header ("SETLIST" / "SETLIST35 · date")
    const hasSeq = /\bstart\s*seq\b/i.test(line);
    line = line.replace(/\[[^\]]*\]/g, " ").trim(); // drop [START SEQ] etc.
    line = line.replace(/\s+(?:medley|manuale|manual)\s*$/i, "").trim(); // drop a trailing print tag
    let key = "";
    const km = line.match(/\(([^)]*)\)\s*$/); // trailing (key)
    if (km) {
      key = (km[1] ?? "").trim();
      line = line.slice(0, km.index).trim();
    }
    const parts = line
      .split("/")
      .map((p) => p.trim())
      .filter((p) => /[a-zA-Z]/.test(p));
    return parts.length ? { hasSeq, key, parts } : null;
  }

  applyTitles(titles: string[], linkMedleys = false): { matched: number; total: number; unmatched: string[] } {
    // Snapshot the MANUAL medley links before rebuilding: every re-import used to recreate all
    // entries with linkedNext=false, silently unlinking hand-made medleys on each Word save — the
    // first song then stopped on its stop note again. Pairs still adjacent after the re-import
    // (same songs, same order) get their link back below.
    const prevPairs = new Set<string>();
    for (let i = 0; i < this.entries.length - 1; i++) {
      const e = this.entries[i]!;
      if (e.linkedNext) prevPairs.add(`${e.libIndex}>${this.entries[i + 1]!.libIndex}`);
    }
    const libTitles = this.library.map((s) => s.title);
    const parsed = titles
      .map((t) => this.parseImportLine(t))
      .filter((x): x is { hasSeq: boolean; key: string; parts: string[] } => x !== null);
    const usesSeq = parsed.some((p) => p.hasSeq);

    const entries: SetlistEntry[] = [];
    const groupIds: number[] = [];
    const used = new Set<number>();
    const unmatched: string[] = [];
    let total = 0;
    let groupId = -1;
    let firstLine = true;
    let lastAddedLib = -1;

    for (const p of parsed) {
      const startsNewGroup = firstLine || (usesSeq ? p.hasSeq : true);
      const lineEntries: SetlistEntry[] = [];
      for (const part of p.parts) {
        total++;
        const m = bestMatch(part, libTitles);
        if (m) {
          // Skip consecutive duplicates, e.g. "WORLD A REGGAE / JAMROCK" where
          // both parts match the same library song -> only add it once.
          if (m.index === lastAddedLib) continue;
          lineEntries.push({ libIndex: m.index, active: true, linkedNext: false, key: p.key });
          used.add(m.index);
          lastAddedLib = m.index;
        } else {
          unmatched.push(part);
        }
      }
      firstLine = false;
      if (lineEntries.length === 0) continue;
      if (startsNewGroup) groupId++;
      for (const e of lineEntries) {
        entries.push(e);
        groupIds.push(groupId);
      }
    }

    // By default imported songs stay SEPARATE — each gets its own setlist number (the user
    // asked that medley parts not collapse onto one number). When linkMedleys is on, "/"-joined
    // parts (or a START SEQ group) are linked into one medley row, the original behaviour.
    if (linkMedleys) {
      for (let i = 0; i < entries.length - 1; i++) {
        if (groupIds[i] === groupIds[i + 1]) entries[i]!.linkedNext = true;
      }
    }
    // Preserve manual medley links across the re-import (pairs still adjacent, see snapshot above).
    for (let i = 0; i < entries.length - 1; i++) {
      if (prevPairs.has(`${entries[i]!.libIndex}>${entries[i + 1]!.libIndex}`)) entries[i]!.linkedNext = true;
    }

    this.library.forEach((_, i) => {
      if (!used.has(i)) entries.push({ libIndex: i, active: false, linkedNext: false, key: "" });
    });
    this.entries = entries;
    this.medleysAreAuto = false; // an import defines its own medleys explicitly
    this.clearHistory();
    this.recompute();
    return { matched: used.size, total, unmatched };
  }

  /** Serialize the working setlist (order + medley + keys) so it can be
   * re-mapped onto a rebuilt library (e.g. after a marker change in Ableton). */
  serialize(): { title: string; active: boolean; linkedNext: boolean; key: string; color?: string }[] {
    return this.entries.map((e) => ({
      title: this.library[e.libIndex]?.title ?? "",
      active: e.active,
      linkedNext: e.linkedNext,
      key: e.key,
      color: e.color,
    }));
  }

  /** Restore a serialized setlist onto the current library (by title). Maps duplicate
   * titles to successive library occurrences (a song reused across medleys), not all to
   * the first. Unreferenced library songs are appended as removed. */
  restoreFromSession(items: { title: string; active: boolean; linkedNext: boolean; key: string; color?: string }[]): { matched: number; total: number } {
    // Key the library by NORMALIZED title (case/space/punctuation/accent-insensitive) so a marker
    // lightly re-typed in Ableton still matches — the old exact-string match returned 0 on the
    // smallest drift. Duplicate titles map to successive library occurrences via the per-title queue.
    const queues = new Map<string, number[]>();
    this.library.forEach((s, i) => {
      const k = normalizeTitle(s.title);
      const arr = queues.get(k);
      if (arr) arr.push(i);
      else queues.set(k, [i]);
    });
    const libTitles = this.library.map((s) => s.title);
    const used = new Set<number>();
    const entries: SetlistEntry[] = [];
    for (const it of items) {
      let li = -1;
      const arr = queues.get(normalizeTitle(it.title));
      if (arr) {
        while (arr.length && used.has(arr[0]!)) arr.shift(); // drop any occurrence already taken
        if (arr.length) li = arr.shift()!;
      }
      if (li < 0) {
        // No normalized match — fall back to a fuzzy match (a bigger rename), high threshold to
        // avoid loose false positives, skipping songs already used by another entry.
        const m = bestMatch(it.title, libTitles, 0.72);
        if (m && !used.has(m.index)) li = m.index;
      }
      if (li < 0) continue;
      entries.push({ libIndex: li, active: !!it.active, linkedNext: !!it.linkedNext, key: it.key ?? "", color: it.color });
      used.add(li);
    }
    const matched = entries.length;
    if (entries.length === 0) return { matched: 0, total: items.length };
    this.library.forEach((_, i) => {
      if (!used.has(i)) entries.push({ libIndex: i, active: false, linkedNext: false, key: "" });
    });
    this.entries = entries;
    this.clearHistory();
    this.recompute();
    return { matched, total: items.length };
  }
}
