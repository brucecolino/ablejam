# AbleJam control surface for Ableton Live 12.
# Reads locators (cue points) + transport from the Live Object Model and exposes
# them over OSC to the AbleJam host; executes play/stop/jump commands.
from __future__ import absolute_import, unicode_literals
import json

try:
    from ableton.v2.control_surface import ControlSurface
except ImportError:  # fallback for older Live
    from _Framework.ControlSurface import ControlSurface

from .osc import OSCServer

HOST_IP = "127.0.0.1"
HOST_PORT = 39062     # the AbleJam host listens here for state
LISTEN_PORT = 39061   # we listen here for commands from the host
BRIDGE_VERSION = 46   # bump on every change; shown in the UI to confirm reloads


class AbleJam(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._active = True
        self._selected_time = None  # start of the currently selected song (beats)
        self._resume_time = None  # paused playhead, for play/pause resume only
        self._seek_target = None  # position to enforce while stopped
        self._seek_ticks = 0
        self._play_target = None  # position to enforce for the first ticks of playback
        self._play_ticks = 0
        self._play_landed = False  # have we confirmed playback reached the target?
        self._saved_master_vol = None  # master volume saved while muting the cold-start
        self._muted_for_play = False   # are we currently muting the start glitch?
        self._last_cue_sig = ""        # signature of cue points, to detect renames
        self._stop_tick = 0            # throttle for re-reading MIDI stop points
        self._stop_track_name = ""     # configured stop track ("" = auto: name contains "stop")
        self._stop_note = -1           # configured stop pitch (-1 = any note)
        self._lyrics_track_name = ""   # configured lyrics track ("" = auto: name contains "lyrics")
        self._last_lyrics_sig = ""     # signature of lyrics clips, to re-send on live edits
        self._lyrics_tick = 0          # throttle for polling lyrics clips
        self._armed_stop = None        # beat to stop AT precisely (armed by host), None = off
        self._prev_time = 0.0          # last playhead position, for tight stop-crossing detection
        self._relocating = False  # guard against re-entrancy while we set song time
        self._last_beat = -1           # last emitted beat-in-bar (0-based) for the CLICK visual
        self._c_instance = c_instance  # low-level handle, used for raw MIDI out
        self._song = c_instance.song()
        self._osc = OSCServer(LISTEN_PORT, (HOST_IP, HOST_PORT))
        self._register_commands()
        self._add_listeners()
        self.schedule_message(1, self._announce)
        self._tick()  # start the steady 10 Hz loop

    # ---- lifecycle ----
    def _announce(self):
        self._osc.send("/ablejam/hello", ["AbleJam bridge connected", BRIDGE_VERSION])
        self._send_setlist()
        self._send_tracks()
        self._send_midi_tracks()
        self._send_stop_points()
        self._send_lyrics()
        # NOTE: AbleJam never touches song.metronome — the user (or their click-automation
        # track) owns it. Toggling it here made the metronome button flicker on every play.
        try:
            self.show_message("AbleJam connected")
        except Exception:
            pass

    def disconnect(self):
        self._active = False
        self._unmute_master()  # safety: restore the master if we unload mid cold-start
        self._remove_listeners()
        self._osc.shutdown()
        ControlSurface.disconnect(self)

    # ---- steady loop: pump incoming OSC + push transport ----
    def _tick(self):
        if not self._active:
            return
        try:
            self._osc.process()
            self._enforce_seek()
            self._enforce_play()
            self._check_armed_stop()  # backup to the fast playhead listener
            self._emit_beat()         # backup beat emit + resets the beat when stopped
            self._send_transport()
            self._check_cues()
            self._stop_tick += 1
            if self._stop_tick >= 20 and not self._song.is_playing:
                self._stop_tick = 0
                self._send_stop_points()  # re-read MIDI stop notes while stopped (setup edits)
            self._lyrics_tick += 1
            if self._lyrics_tick >= 3:
                self._lyrics_tick = 0
                self._check_lyrics()  # live-refresh lyrics as the user renames/moves clips
        except Exception:
            pass
        self.schedule_message(1, self._tick)  # ~100 ms per tick

    def _check_cues(self):
        # Re-send the setlist when a cue point is RENAMED or moved. The cue_points
        # listener only fires on add/remove, so renames would otherwise never reach
        # AbleJam. Cheap signature compare; only re-sends on an actual change.
        try:
            sig = "|".join("%s@%.3f" % (c.name, c.time) for c in self._song.cue_points)
        except Exception:
            return
        if sig != self._last_cue_sig:
            self._last_cue_sig = sig
            self._send_setlist()

    # ---- listeners ----
    def _add_listeners(self):
        try:
            self._song.add_cue_points_listener(self._send_setlist)
        except Exception:
            pass
        try:
            self._song.add_is_playing_listener(self._send_transport)
        except Exception:
            pass
        try:
            # Fires fast as the playhead moves -> lets us snap onto the target the
            # instant playback rolls, minimizing the cold-start audio glitch.
            self._song.add_current_song_time_listener(self._on_song_time)
        except Exception:
            pass

    def _remove_listeners(self):
        for remover, fn in (
            (getattr(self._song, "remove_cue_points_listener", None), self._send_setlist),
            (getattr(self._song, "remove_is_playing_listener", None), self._send_transport),
            (getattr(self._song, "remove_current_song_time_listener", None), self._on_song_time),
        ):
            try:
                if remover is not None:
                    remover(fn)
            except Exception:
                pass

    # ---- commands ----
    def _register_commands(self):
        o = self._osc
        o.on("/ablejam/cmd/play", lambda a: self._play())
        o.on("/ablejam/cmd/stop", lambda a: self._stop())
        o.on("/ablejam/cmd/pause", lambda a: self._pause())
        o.on("/ablejam/cmd/nextSong", lambda a: self._jump_relative(1))
        o.on("/ablejam/cmd/prevSong", lambda a: self._jump_relative(-1))
        o.on("/ablejam/cmd/jumpToSong", lambda a: self._jump_to(int(a[0]) if a else 0))
        o.on("/ablejam/cmd/jumpToTime", lambda a: self._jump_to_time(float(a[0]) if a else 0.0))
        o.on("/ablejam/cmd/stopToStart", lambda a: self._stop_to_start(float(a[0]) if a else 0.0))
        o.on("/ablejam/cmd/setSelected", lambda a: self._set_selected(float(a[0]) if a else 0.0))
        o.on("/ablejam/cmd/stopConfig", lambda a: self._stop_config(a))
        o.on("/ablejam/cmd/lyricsConfig", lambda a: self._lyrics_config(a))
        o.on("/ablejam/cmd/renameLyrics", lambda a: self._rename_lyrics(a[0] if a else "[]"))
        o.on("/ablejam/cmd/writeLyrics", lambda a: self._write_lyrics_clips(a[0] if a else "[]"))
        o.on("/ablejam/cmd/colorize", lambda a: self._colorize(a[0] if a else "[]"))
        o.on("/ablejam/cmd/cleanClips", lambda a: self._clean_clips(a[0] if a else "{}"))
        o.on("/ablejam/cmd/renameCues", lambda a: self._rename_cues(a[0] if a else "[]"))
        o.on("/ablejam/cmd/metronome", lambda a: self._set_metronome(int(a[0]) if a else 0))
        o.on("/ablejam/cmd/armStop", lambda a: self._arm_stop(float(a[0]) if a else -1.0))
        o.on("/ablejam/cmd/fireClip", lambda a: self._fire_clip(a[0] if a else ""))
        o.on("/ablejam/cmd/sendNote", lambda a: self._send_note(int(a[0]) if a else 36))
        o.on("/ablejam/cmd/reenableAutomation", lambda a: self._reenable_automation())
        o.on("/ablejam/cmd/refresh", lambda a: self._on_refresh())

    def _on_refresh(self):
        # Re-announce the version too: the host may have (re)started and missed the
        # one-shot hello, which would leave the version stuck at 0.
        self._osc.send("/ablejam/hello", ["AbleJam bridge connected", BRIDGE_VERSION])
        self._send_setlist()
        self._send_tracks()
        self._send_midi_tracks()
        self._send_stop_points()
        self._send_lyrics()
        self._send_autotune_diag()

    def _send_autotune_diag(self):
        # Dump the AUTOTUNE track's devices + (key/scale-ish) parameters so the host can learn
        # which params hold the rootnote + scale (plugin-specific). Quantized params expose
        # value_items (the string labels, e.g. "E", "Minor") — that's how we'll read the key.
        out = []
        try:
            for tr in self._song.tracks:
                if "autotune" not in (tr.name or "").lower():
                    continue
                for dev in tr.devices:
                    params = []
                    try:
                        plist = list(dev.parameters)
                    except Exception:
                        plist = []
                    for pr in plist:
                        nm = pr.name or ""
                        low = nm.lower()
                        match = any(k in low for k in ("key", "scale", "root", "note", "pitch", "tune"))
                        if not match:
                            params.append({"name": nm})
                            continue
                        item = {"name": nm}
                        try:
                            item["value"] = pr.value
                        except Exception:
                            pass
                        try:
                            if getattr(pr, "is_quantized", False):
                                vi = [str(x) for x in (pr.value_items or [])]
                                item["items"] = vi
                                iv = int(pr.value)
                                if 0 <= iv < len(vi):
                                    item["cur"] = vi[iv]
                        except Exception:
                            pass
                        params.append(item)
                    out.append({"track": tr.name, "device": dev.name, "params": params[:80]})
        except Exception as e:
            out = [{"error": str(e)}]
        try:
            self._osc.send("/ablejam/autotunediag", [json.dumps(out)])
        except Exception:
            pass

    # ---- transport ----
    # Live's stop_playing() rewinds the playhead to where playback last started,
    # and that rewind races with (and can clobber) a position we set right after.
    # So after every stop / select-while-stopped we ENFORCE the wanted position
    # for a few ticks while stopped (_enforce_seek), which reliably wins the race.
    # NOTE: clean PLAY from a song start uses cue_point.jump()+start_playing() (see _play),
    # not current_song_time — start_playing() begins from the insert marker, not the playhead.
    def _request_seek(self, beats):
        self._play_ticks = 0  # cancel any pending play window: we're seeking while stopped
        self._unmute_master()  # not in a cold start anymore -> restore the master
        self._seek_target = max(0.0, beats)
        self._seek_ticks = 6  # ~600 ms of enforcement while stopped
        try:
            self._song.current_song_time = self._seek_target
        except Exception:
            pass

    def _enforce_seek(self):
        if self._seek_ticks <= 0 or self._seek_target is None:
            return
        if self._song.is_playing:
            self._seek_ticks = 0  # playing: nothing to fight
            return
        try:
            if abs(self._song.current_song_time - self._seek_target) > 1e-4:
                self._song.current_song_time = self._seek_target
        except Exception:
            pass
        self._seek_ticks -= 1

    # ---- master mute: hide the cold-start roll on the FALLBACK path only ----
    # The clean play path (cue_point.jump + start_playing, see _play) never rolls, so it
    # needs NO mute. Only the fallback (mid-song rehearsal seek / pause-resume) still uses
    # current_song_time, which rolls ~1 buffer; we drop the master to silence for that and
    # restore on landing. We do NOT touch song.metronome anymore (it made the metronome
    # button flicker every play); the user's own click track / metronome stays untouched.
    def _mute_master(self):
        if self._muted_for_play:
            return
        try:
            vol = self._song.master_track.mixer_device.volume
            self._saved_master_vol = vol.value
            vol.value = 0.0
        except Exception:
            self._saved_master_vol = None
        self._muted_for_play = True

    def _unmute_master(self):
        if not self._muted_for_play:
            return
        try:
            if self._saved_master_vol is not None:
                self._song.master_track.mixer_device.volume.value = self._saved_master_vol
        except Exception:
            pass
        self._muted_for_play = False
        self._saved_master_vol = None

    def _cue_near(self, beat, tol=0.05):
        # The nearest locator (cue point) within `tol` beats of `beat`, if any. Song starts
        # ARE locators; a small tolerance absorbs the float32 round-trip of the OSC beat.
        if beat is None:
            return None
        best = None
        bestd = tol
        try:
            for cp in self._song.cue_points:
                d = abs(cp.time - beat)
                if d <= bestd:
                    bestd = d
                    best = cp
        except Exception:
            return None
        return best

    def _play(self):
        # CLEAN START: Live's start_playing() begins from the INSERT MARKER (song.start_time),
        # NOT from current_song_time. Setting current_song_time while stopped does not move
        # that marker, so continue_playing() used to roll from a stale marker for a buffer
        # (the audible wrong-position blip + click) before snapping. The fix: seat the insert
        # marker on the song's locator with cue_point.jump() FIRST, then start_playing() —
        # the engine never starts from a wrong marker, so no roll, no click, no master mute.
        target = self._resume_time if self._resume_time is not None else self._selected_time
        self._resume_time = None
        self._seek_ticks = 0
        s = self._song
        # Probe for a locator at the selected start (or, if nothing was selected, at the
        # current playhead — e.g. the user parked on a song start). Only while stopped.
        cp = None
        if not s.is_playing:
            probe = target if target is not None else s.current_song_time
            cp = self._cue_near(probe)
        if cp is not None:
            self._play_ticks = 0
            self._play_target = None
            self._play_landed = True
            self._unmute_master()
            try:
                cp.jump()             # seats insert marker + playhead on the locator (stopped)
            except Exception:
                try:
                    s.current_song_time = cp.time
                except Exception:
                    pass
            try:
                s.start_playing()     # starts FROM the insert marker = the locator -> clean
            except Exception:
                pass
            return
        # Fallback: already playing (relocate live) OR target not on a locator (pause-resume
        # mid-song / rehearsal seek). The only lever is current_song_time, which rolls ~1
        # buffer from the stale marker -> hide it with the master mute while snapping.
        if target is not None and not s.is_playing:
            self._mute_master()
        try:
            s.continue_playing()
        except Exception:
            pass
        self._arm_play_target(target)

    def _arm_play_target(self, target):
        # Drive playback onto `target`: assert it now and keep enforcing for ~1.2 s.
        # Only relocate when meaningfully off target, so a seamless medley roll-over
        # (already at the next song's start) isn't nudged into a micro-glitch.
        self._play_target = target
        self._play_ticks = 12 if target is not None else 0
        self._play_landed = False
        if target is None or self._muted_for_play:
            return  # cold start (muted): let the single snap do the ONE relocation
        try:
            if abs(self._song.current_song_time - target) > 0.5:
                self._song.current_song_time = target
        except Exception:
            pass

    def _snap_to_play_target(self):
        # Returns True when the play window is done.
        if self._play_target is None:
            self._unmute_master()
            return True
        if self._play_landed:
            return True
        if not self._song.is_playing:
            return False  # transport not rolling yet -> keep waiting
        target = self._play_target
        if self._muted_for_play:
            # COLD START (muted): on the first playing tick force the EXACT marker. This
            # is what fixes medleys — their songs are contiguous, so the start roll can
            # land on a NEARBY segment that a position window would wrongly accept. We're
            # muted, so forcing the exact position is inaudible; then reveal.
            self._song.current_song_time = target
            self._play_landed = True
            self._unmute_master()
            return True
        # Jump/medley WHILE ALREADY PLAYING (audible): only correct a real wrong-song
        # jump; never reset normal forward motion (keeps medley transitions seamless).
        pos = self._song.current_song_time
        if target - 0.1 <= pos <= target + 1.0:
            self._play_landed = True
            return True
        self._song.current_song_time = target
        return False

    def _on_song_time(self):
        # Fast path: fires as the playhead moves. First check the armed MIDI stop so we can
        # halt EXACTLY on the note (no host round-trip), then snap a cold start onto target.
        if self._relocating:
            return
        self._check_armed_stop()
        self._emit_beat()  # tight CLICK-visual beat: fires the instant Live's beat-in-bar changes
        if self._play_ticks <= 0:
            return
        try:
            self._relocating = True
            if self._snap_to_play_target():
                self._play_ticks = 0  # landed -> stop enforcing (no snap-back later)
        except Exception:
            pass
        finally:
            self._relocating = False

    def _emit_beat(self):
        # Send the metronome's exact beat-in-bar (0-based) the moment it changes, from Live's own beat
        # clock (get_current_beats_song_time().beats is 1-based and honors the time signature). This is
        # what the CLICK visual follows — perfectly aligned with the audible click, no extrapolation.
        try:
            if not self._song.is_playing:
                self._last_beat = -1
                return
            bt = self._song.get_current_beats_song_time()
            b = int(bt.beats) - 1
            if b != self._last_beat:
                self._last_beat = b
                self._osc.send("/ablejam/beat", [("i", int(b))])
        except Exception:
            pass

    def _arm_stop(self, beat):
        # Host arms the exact beat to stop at (the MIDI-note position for the current song);
        # -1 disarms. The bridge stops itself when the playhead reaches it -> no OSC latency.
        self._armed_stop = beat if (beat is not None and beat >= 0) else None

    def _check_armed_stop(self):
        # Stop the instant the playhead reaches the armed beat. Runs from the fast playhead
        # listener (tight) and the 100 ms tick (backup). Forward-crossing only.
        if self._relocating:
            return
        a = self._armed_stop
        try:
            cur = self._song.current_song_time
            playing = self._song.is_playing
        except Exception:
            return
        if a is None or not playing:
            self._prev_time = cur
            return
        prev = self._prev_time
        self._prev_time = cur
        if cur < prev:  # loop / backward relocation -> not a forward crossing
            return
        if prev < a <= cur + 1e-9:
            self._armed_stop = None
            self._play_ticks = 0
            self._play_landed = True
            self._resume_time = None
            self._unmute_master()
            try:
                self._song.stop_playing()
            except Exception:
                pass
            try:
                self._osc.send("/ablejam/midistop", [("f", float(a))])
            except Exception:
                pass

    def _enforce_play(self):
        # Backup path on the 100 ms tick + handles the is_playing flip lag: while the
        # transport hasn't rolled yet, keep (re)issuing play + seek; once playing, snap.
        if self._play_ticks <= 0 or self._play_target is None:
            if self._muted_for_play:
                self._unmute_master()   # watchdog: never leave the master muted
            return
        self._play_ticks -= 1
        if self._relocating:
            return
        try:
            self._relocating = True
            if self._song.is_playing:
                if self._snap_to_play_target():
                    self._play_ticks = 0
            else:
                self._song.continue_playing()                 # not rolling yet: retry
                self._song.current_song_time = self._play_target
        except Exception:
            pass
        finally:
            self._relocating = False
        if self._play_ticks <= 0 and self._muted_for_play:
            self._unmute_master()       # window expired without landing -> reveal anyway

    def _pause(self):
        self._resume_time = self._song.current_song_time
        self._song.stop_playing()
        self._request_seek(self._resume_time)  # stay at the pause point

    def _stop(self):
        # Stop and return to the START of the SELECTED song (not wherever the
        # playhead drifted, and not the first song).
        self._resume_time = None
        self._play_ticks = 0  # cancel any pending play window so Stop isn't undone
        self._unmute_master()  # safety: never leave the master muted on stop
        self._song.stop_playing()
        if self._selected_time is not None:
            self._request_seek(self._selected_time)

    def _current_song_start(self, pos):
        best = None
        for c in self._song.cue_points:
            if c.time <= pos + 1e-6 and (best is None or c.time > best):
                best = c.time
        return best

    # ---- helpers ----
    def _cues_sorted(self):
        cues = list(self._song.cue_points)
        cues.sort(key=lambda c: c.time)
        return cues

    def _current_index(self):
        t = self._song.current_song_time
        idx = -1
        for i, c in enumerate(self._cues_sorted()):
            if c.time <= t + 1e-6:
                idx = i
            else:
                break
        return idx

    def _jump_relative(self, delta):
        cues = self._cues_sorted()
        if not cues:
            return
        nidx = max(0, min(len(cues) - 1, self._current_index() + delta))
        self._song.current_song_time = cues[nidx].time

    def _jump_to(self, index):
        cues = self._cues_sorted()
        if 0 <= index < len(cues):
            self._song.current_song_time = cues[index].time

    def _stop_to_start(self, beats):
        # Atomic STOP + return to the song start. One handler so there is NO is_playing
        # race between stopping and seeking: the old "send cmdStop then cmdJumpToTime"
        # let the jump re-arm play (is_playing still True for a tick) and undo the stop
        # -> Stop appeared to work only ~1 time in 5. Here nothing checks is_playing.
        beats = max(0.0, beats)
        self._resume_time = None
        self._play_ticks = 0       # cancel any pending play window
        self._play_landed = True   # block enforcement from re-issuing play
        self._unmute_master()
        self._selected_time = beats
        self._song.stop_playing()
        self._request_seek(beats)  # park the cursor at the song start (enforced)

    def _set_selected(self, beats):
        # Tell the bridge which song is currently shown/selected (without moving the
        # playhead), so Play starts THAT song even when it was derived, not jumped.
        self._selected_time = max(0.0, beats)

    def _set_metronome(self, on):
        # AbleJam's click toggle (Setlist + Performance). The ONLY place we touch the
        # metronome, and only on explicit user action.
        try:
            self._song.metronome = bool(on)
        except Exception:
            pass

    def _jump_to_time(self, beats):
        # Select a song. Any jump (select / next / prev / Restart) clears the pause
        # memory, so the song begins from its start — resume is only for play/pause.
        beats = max(0.0, beats)
        self._selected_time = beats
        self._resume_time = None
        if self._song.is_playing:
            self._arm_play_target(beats)  # relocate while playing (enforced + fast snap)
        else:
            self._request_seek(beats)     # enforce vs the stop-rewind while stopped

    # ---- outgoing state ----
    def _send_setlist(self):
        songs = [{"name": c.name, "time": c.time} for c in self._cues_sorted()]
        self._osc.send("/ablejam/setlist", [json.dumps(songs)])

    def _send_tracks(self):
        try:
            names = [t.name for t in self._song.tracks]
        except Exception:
            names = []
        self._osc.send("/ablejam/tracks", [json.dumps(names)])

    def _send_midi_tracks(self):
        # MIDI tracks only — for the "stop track" selector in Settings.
        names = []
        try:
            for t in self._song.tracks:
                try:
                    if t.has_midi_input:
                        names.append(t.name)
                except Exception:
                    pass
        except Exception:
            pass
        self._osc.send("/ablejam/miditracks", [json.dumps(names)])

    # ---- Lyrics: a track (named "LYRICS" by default, configurable) whose arrangement clips are
    # one-per-line — clip name = text, clip left/right edges = start/end arrangement beats. Travels
    # with the .als, syncs to the playhead exactly like the stop points.
    def _lyrics_config(self, a):
        try:
            self._lyrics_track_name = (str(a[0]).strip() if a and a[0] is not None else "")
        except Exception:
            pass
        self._send_lyrics()

    def _find_lyrics_track(self):
        want = (self._lyrics_track_name or "").strip().lower()
        try:
            if want:
                for t in self._song.tracks:
                    if (t.name or "").strip().lower() == want:
                        return t
                return None
            for t in self._song.tracks:
                if "lyrics" in (t.name or "").strip().lower():
                    return t
        except Exception:
            pass
        return None

    def _send_lyrics(self):
        lines = []
        track = self._find_lyrics_track()
        if track is not None:
            try:
                for clip in track.arrangement_clips:
                    try:
                        text = clip.name or ""
                        if not text.strip():
                            continue
                        lines.append({"text": text, "start": float(clip.start_time), "end": float(clip.end_time)})
                    except Exception:
                        pass
            except Exception:
                pass
        lines.sort(key=lambda x: x["start"])
        self._last_lyrics_sig = "|".join("%s@%.3f-%.3f" % (l["text"], l["start"], l["end"]) for l in lines)
        self._osc.send("/ablejam/lyrics", [json.dumps(lines)])

    def _rename_lyrics_items(self, items):
        # Name each clip from the line whose start is nearest (within tolerance). Robust for sparse
        # clips / multi-song docs; lines moved in AbleJam won't match a clip -> left untouched.
        track = self._find_lyrics_track()
        if track is None or not items:
            return
        tol = 0.25
        try:
            for clip in track.arrangement_clips:
                try:
                    cs = float(clip.start_time)
                    best = None
                    bestd = tol
                    for it in items:
                        d = abs(float(it.get("s", 0.0)) - cs)
                        if d <= bestd:
                            bestd = d
                            best = it
                    if best is not None:
                        clip.name = str(best.get("t", ""))
                except Exception:
                    pass
        except Exception:
            pass

    def _rename_lyrics(self, payload):
        try:
            items = json.loads(payload) if payload else []
        except Exception:
            return
        self._rename_lyrics_items(items)
        self._send_lyrics()

    def _lyrics_template(self, track):
        # A clip to duplicate. PREFER a fresh EMPTY MIDI clip in a free session slot (clean, short).
        # FALLBACK (audio track, or MIDI with no free slot): reuse an existing clip on the track — we
        # strip its MIDI notes after duplicating so nothing audible leaks. Returns (clip, slot_to_delete, fresh).
        try:
            if getattr(track, "has_midi_input", False):
                for slot in track.clip_slots:
                    if not slot.has_clip:
                        try:
                            slot.create_clip(1.0)  # 1-beat marker clip
                            return slot.clip, slot, True
                        except Exception:
                            pass
        except Exception:
            pass
        try:
            for c in track.arrangement_clips:
                return c, None, False
        except Exception:
            pass
        try:
            for slot in track.clip_slots:
                if slot.has_clip:
                    return slot.clip, None, False
        except Exception:
            pass
        return None, None, False

    def _write_lyrics_clips(self, payload):
        # Create one short clip per sent line at its start beat. Idempotent: never places a clip where
        # one already exists (existing OR created this pass) so re-pressing / dense lines can't dup or
        # overwrite. Names the new clip directly. Reports [created, total, reason] to the host.
        try:
            items = json.loads(payload) if payload else []
        except Exception:
            items = []
        track = self._find_lyrics_track()
        total = len(items)
        if track is None:
            self._osc.send("/ablejam/lyricswrite", [0, total, "notrack"])
            return
        if not items:
            self._osc.send("/ablejam/lyricswrite", [0, 0, ""])
            return
        occupied = []  # start beats already taken (existing clips + ones we add) — no overlap/dup
        try:
            for c in track.arrangement_clips:
                try:
                    occupied.append(float(c.start_time))
                except Exception:
                    pass
        except Exception:
            pass
        template, temp_slot, fresh = self._lyrics_template(track)
        if template is None:
            self._osc.send("/ablejam/lyricswrite", [0, total, "empty"])  # no clip to template from
            return
        created = 0
        new_items = []  # the lines we actually created a clip for
        tol = 0.25
        for it in sorted(items, key=lambda x: float(x.get("s", 0.0))):
            try:
                start = float(it.get("s", 0.0))
                if any(abs(o - start) < tol for o in occupied):
                    continue  # a clip is already there — skip (idempotent, never overlaps)
                new_clip = track.duplicate_clip_to_arrangement(template, start)
                try:
                    if new_clip is not None:
                        new_clip.name = str(it.get("t", ""))
                        if not fresh and getattr(new_clip, "is_midi_clip", False):
                            try:
                                new_clip.remove_notes_extended(0, 128, 0.0, 1.0e9)  # strip leaked notes from a reused template
                            except Exception:
                                pass
                except Exception:
                    pass
                occupied.append(start)
                new_items.append(it)
                created += 1
            except Exception:
                pass
        if temp_slot is not None:
            try:
                temp_slot.delete_clip()
            except Exception:
                pass
        # Safety: name the created clips by position too (covers a None return from duplicate). Scoped to
        # new_items only — their starts are >= tol from existing clips, so no existing clip is touched.
        self._rename_lyrics_items(new_items)
        self._send_lyrics()
        self._osc.send("/ablejam/lyricswrite", [created, total, ""])

    def _check_lyrics(self):
        # Cheap signature (same sort as _send_lyrics) so renames/moves/resizes reach AbleJam live.
        track = self._find_lyrics_track()
        items = []
        if track is not None:
            try:
                for clip in track.arrangement_clips:
                    try:
                        nm = clip.name or ""
                        if nm.strip():
                            items.append((float(clip.start_time), float(clip.end_time), nm))
                    except Exception:
                        pass
            except Exception:
                return
        items.sort(key=lambda x: x[0])
        sig = "|".join("%s@%.3f-%.3f" % (nm, s, e) for (s, e, nm) in items)
        if sig != self._last_lyrics_sig:
            self._send_lyrics()

    def _stop_config(self, a):
        # Host tells us which track + note mark song endings. Re-read immediately.
        try:
            self._stop_track_name = (str(a[0]).strip() if a and a[0] is not None else "")
            self._stop_note = int(a[1]) if len(a) > 1 else -1
        except Exception:
            pass
        self._send_stop_points()

    # ---- MIDI stop points (invisible, project-based: a track named "*stop*" with MIDI
    # impulses at the beats where the matching song must stop). Travels with the .als,
    # so it survives every setlist reload/import.
    def _find_stop_track(self):
        # Configured track wins (exact name, case-insensitive); else auto: name has "stop".
        want = (self._stop_track_name or "").strip().lower()
        try:
            if want:
                for t in self._song.tracks:
                    if (t.name or "").strip().lower() == want:
                        return t
                return None
            for t in self._song.tracks:
                if "stop" in (t.name or "").strip().lower():
                    return t
        except Exception:
            pass
        return None

    def _clip_note_times(self, clip):
        # Read EVERY note of the clip's content (note times are in clip-content beats where
        # the clip's 1.1.1 == 0). Read from 0 with a HUGE span: clip.length is only the
        # loop/play length, so sizing the window with it silently drops notes on a long
        # arrangement clip. Read all 128 pitches and filter the configured stop pitch in
        # Python (a 1-wide pitch window returns nothing if the pitch/octave is mis-set).
        want = self._stop_note  # -1 == any note
        times = []
        try:
            for n in clip.get_notes_extended(0, 128, 0.0, 1.0e9):
                if want < 0 or int(n.pitch) == want:
                    times.append(n.start_time)
            return times
        except Exception:
            pass
        try:
            for nt in clip.get_notes(0.0, 0, 1.0e9, 128):  # (pitch,time,dur,vel,mute)
                if want < 0 or int(nt[0]) == want:
                    times.append(nt[1])
        except Exception:
            return []
        return times

    def _send_stop_points(self):
        points = []
        diag = ""
        track = self._find_stop_track()
        if track is not None:
            try:
                for clip in track.arrangement_clips:
                    try:
                        if not clip.is_midi_clip:
                            continue
                        # Absolute arrangement beat = clip's left-edge arrangement position
                        # + (note content beat - clip start marker). clip.start_time is the
                        # LEFT EDGE (= content beat `start_marker`), NOT content 1.1.1 — so a
                        # trimmed/offset clip needs the start_marker term, else every note
                        # reads one bar (or more) too late.
                        base = clip.start_time
                        try:
                            off = clip.start_marker
                        except Exception:
                            off = 0.0
                        times = self._clip_note_times(clip)
                        if not diag and times:
                            try:
                                ls = clip.loop_start
                            except Exception:
                                ls = 0.0
                            diag = ("clipStart=%.2f startMarker=%.2f loopStart=%.2f note0=%.2f -> beat=%.2f"
                                    % (base, off, ls, times[0], base + times[0] - off))
                        for t in times:
                            points.append(round(base + t - off, 4))
                    except Exception:
                        pass
            except Exception:
                pass
        self._osc.send("/ablejam/stoppoints", [json.dumps(sorted(set(points)))])
        self._osc.send("/ablejam/stopdiag", [diag])

    def _rename_cues(self, payload):
        # Rename locators (cue points) so Ableton OWNS the song keys. The host sends
        # items = [{"time": beat, "name": "TITLE (Am) /"}, ...]; we match each to the
        # cue point at that beat and set its name. Reports how many succeeded (cue_point.name
        # is read-only on some older Lives -> count will be 0, telling the host it's unsupported).
        try:
            items = json.loads(payload) if isinstance(payload, (str, bytes)) else (payload or [])
        except Exception:
            items = []
        cues = list(self._song.cue_points)
        done = 0
        for it in items:
            try:
                t = float(it.get("time", -1.0))
                name = it.get("name", "")
            except Exception:
                continue
            if not name:
                continue
            best = None
            best_d = 1e9
            for cp in cues:
                d = abs(cp.time - t)
                if d < best_d:
                    best_d = d
                    best = cp
            if best is not None and best_d < 0.05:
                try:
                    best.name = name
                    done += 1
                except Exception:
                    pass
        try:
            self._osc.send("/ablejam/renamed", [int(done), int(len(items))])
        except Exception:
            pass
        self._send_setlist()

    def _colorize(self, payload):
        # Paint every arrangement clip with its song's gradient color (computed by the
        # host). ranges = [{"s": startBeat, "e": endBeat, "c": 0xRRGGBB}, ...], timeline
        # order. A clip belongs to the song range that contains its start. Undoable in Live.
        try:
            ranges = json.loads(payload) if isinstance(payload, (str, bytes)) else (payload or [])
        except Exception:
            return
        if not ranges:
            return

        def color_for(t):
            # The clip belongs to the range it STARTS in: the one with the largest start
            # <= t. No upper bound, so boundary/float edge cases never leave a clip grey.
            best_c = None
            best_s = None
            for r in ranges:
                try:
                    rs = r["s"]
                except Exception:
                    continue
                if rs - 1e-6 <= t and (best_s is None or rs > best_s):
                    best_s = rs
                    best_c = int(r["c"]) & 0xFFFFFF
            return best_c

        count = 0
        total = 0
        try:
            for track in self._song.tracks:
                try:
                    for clip in track.arrangement_clips:
                        total += 1
                        try:
                            c = color_for(clip.start_time)
                            if c is not None:
                                clip.color = c
                                count += 1
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            pass
        try:
            self.show_message("AbleJam: colorate %d / %d clip" % (count, total))
        except Exception:
            pass
        try:
            self._osc.send("/ablejam/colorized", [("i", int(count)), ("i", int(total))])
        except Exception:
            pass

    def _clean_clips(self, payload):
        # Rename every arrangement clip "<Song> - <Track>" for a tidy project. Each clip is matched to
        # the song range [s, e) that contains its start. The lyrics track is skipped (its clip names
        # ARE the lyric lines). Reports [renamed, total].
        try:
            data = json.loads(payload) if payload else {}
        except Exception:
            data = {}
        rngs = []
        for r in (data.get("songs") or []):
            try:
                rngs.append((float(r["s"]), float(r.get("e", r["s"])), str(r.get("t", "")).strip()))
            except Exception:
                pass
        rngs.sort(key=lambda x: x[0])
        skip = (data.get("skipTrack") or "").strip().lower()

        def title_for(t):
            best = None
            for (s, e, title) in rngs:
                if s - 1e-6 <= t < e + 1e-6 and (best is None or s > best[0]):
                    best = (s, title)
            return best[1] if best else None

        lyr = self._find_lyrics_track()
        count = 0
        total = 0
        try:
            for track in self._song.tracks:
                try:
                    if track is lyr:
                        continue
                    tname = (track.name or "").strip()
                    if skip and tname.lower() == skip:
                        continue
                    for clip in track.arrangement_clips:
                        total += 1
                        try:
                            title = title_for(float(clip.start_time))
                            if title:
                                clip.name = ("%s - %s" % (title, tname)) if tname else title
                                count += 1
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            pass
        try:
            self.show_message("AbleJam: rinominate %d / %d clip" % (count, total))
        except Exception:
            pass
        try:
            self._osc.send("/ablejam/cleaned", [("i", int(count)), ("i", int(total))])
        except Exception:
            pass

    def _reenable_automation(self):
        try:
            self._song.re_enable_automation()
        except Exception:
            pass

    def _raw_midi(self, event):
        # Send raw MIDI out the control-surface output. Use the low-level c_instance
        # path first (most reliable across Live versions), then the framework helper.
        sent = False
        try:
            self._c_instance.send_midi(tuple(event))
            sent = True
        except Exception:
            sent = False
        if not sent:
            try:
                self._send_midi(tuple(event))
            except Exception:
                pass

    def _send_note(self, note):
        # Emergency "panic": send a real MIDI note out the AbleJam control-surface
        # MIDI output — exactly like a connected MIDI keyboard. NO clips ever.
        # Route the drum-rack track's "MIDI From" to AbleJam (monitor In) to play it.
        pitch = int(note) & 0x7F
        self._raw_midi((0x90, pitch, 110))  # note on, channel 1
        self.schedule_message(3, lambda: self._note_off(pitch))  # note off shortly after

    def _note_off(self, pitch):
        self._raw_midi((0x80, int(pitch) & 0x7F, 0))

    def _fire_clip(self, track_name):
        # Emergency sample: fire the first clip on the named track (plays through
        # Live's engine / the show's audio path).
        name = (track_name or "").strip() if isinstance(track_name, str) else ""
        if not name:
            return
        try:
            for t in self._song.tracks:
                if t.name == name:
                    for slot in t.clip_slots:
                        if slot.has_clip:
                            slot.fire()
                            return
                    return
        except Exception:
            pass

    def _send_transport(self):
        s = self._song
        try:
            metro = 1 if s.metronome else 0
        except Exception:
            metro = 0
        self._osc.send("/ablejam/transport", [
            ("i", 1 if s.is_playing else 0),
            ("f", float(s.current_song_time)),
            ("f", float(s.tempo)),
            ("i", int(s.signature_numerator)),
            ("i", int(s.signature_denominator)),
            ("i", int(self._current_index())),
            ("i", metro),
        ])
