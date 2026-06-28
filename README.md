# AbleJam

Setlist manager for Ableton Live — inspired by AbleSet, built clean-room as our
own. See [PLAN.md](PLAN.md) (architecture + roadmap), [SPEC.md](SPEC.md)
(functional spec), and [bridge/README.md](bridge/README.md).

> **Installare l'app (Windows `.exe` / macOS `.dmg`) → [INSTALL.md](INSTALL.md).**
> Quella guida è per gli utenti finali; quanto segue è per lo sviluppo.

## Architecture

```
Ableton Live ── Python control surface ──OSC/UDP──► Host (Node) ──WebSocket──► UI (browser)
   (LOM)          bridge/AbleJam/                packages/host         packages/web
```

## Monorepo

- `bridge/AbleJam/` — Ableton Live control surface (Python, no deps).
- `packages/shared` — protocol types, OSC addresses, OSC wire codec.
- `packages/host` — Node host: OSC ↔ Live, WebSocket ↔ UI, static server.
- `packages/web` — React UI.

## Quick start (M0)

```bash
pnpm install
```

**Option A — without Ableton (mock bridge), to verify host + UI:**

```bash
pnpm dev:host    # terminal 1: host on :3700
pnpm mock        # terminal 2: emulates Live, streams a fake setlist
pnpm dev:web     # terminal 3: Vite UI on http://localhost:4747
```

Open http://localhost:4747 → you should see the setlist; Play/Stop/Next/Prev and
clicking a song drive the mock. The "Live" dot turns green when the bridge (mock
or real) is connected.

**Option B — with Ableton Live 12:**

1. `./bridge/install.ps1` then select **AbleJam** as a Control Surface in Live.
2. Open a set with a few named locators.
3. `pnpm dev:host` and `pnpm dev:web`, open the UI. Controls now drive Live.

From another device on the LAN, open `http://<this-computer-ip>:4747`.

## Scripts
- `pnpm dev` — host + web in parallel.
- `pnpm dev:host` / `pnpm dev:web` / `pnpm mock` — individually.
- `pnpm build` — build all packages. `pnpm typecheck` — type-check all. `pnpm test` — run tests.

## Updating the bridge (IMPORTANT)
The Ableton control surface (`bridge/`) is Python loaded **inside Live**. After any
change you must reinstall (`./bridge/install.ps1`) **and reload it in Live**
(Settings → MIDI → set slot to *None*, then back to *AbleJam*) — editing the file
alone does nothing in a running Live. The UI shows the loaded version next to the
**Live** dot (e.g. `Live v8`); if it doesn't match the latest, Live wasn't reloaded.
