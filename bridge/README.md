# AbleJam Bridge (Ableton Live control surface)

A MIDI Remote Script that runs inside Ableton Live 12. It reads locators
(cue points) and the transport from the Live Object Model and talks to the
AbleJam host over OSC/UDP on localhost.

- Host listens for **state** on UDP `39062` (`/ablejam/setlist`, `/ablejam/transport`, `/ablejam/hello`)
- Bridge listens for **commands** on UDP `39061` (`/ablejam/cmd/*`)

No external Python packages — uses only the standard library available inside
Live's embedded Python (Live 12 ≈ Python 3.11).

## Install

```powershell
./install.ps1
```

This copies the `AbleJam/` folder to
`Documents/Ableton/User Library/Remote Scripts/AbleJam`.

Then in Live: **Settings → MIDI → Control Surface → AbleJam**. You should see
`AbleJam connected` in the status bar.

To install manually, copy the `AbleJam/` folder into your Remote Scripts folder
(User Library, or `<Live install>/Resources/MIDI Remote Scripts`).

## Files
- `AbleJam/__init__.py` — `create_instance()` entry point Live looks for.
- `AbleJam/ablejam.py` — the `ControlSurface` subclass (LOM access + commands).
- `AbleJam/osc.py` — stdlib OSC codec + non-blocking UDP server.

## M0 scope / known limitations
- `pause` is mapped to `stop` (Live has no native pause; refined in M1).
- Transport is pushed at ~10 Hz via the tick loop. High-frequency, sample-accurate
  playhead comes in M1 via a Max for Live device (you have Live 12 Suite).
- Reads song locators only; sections/lyrics/flags land in later milestones.
