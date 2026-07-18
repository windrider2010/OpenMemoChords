# OpenMemoChords

OpenMemoChords is a local-first, adaptive music-reading web app for young piano learners. It builds directly on the Git history and MIT license of [windrider2010/OpenMemoChords](https://github.com/windrider2010/OpenMemoChords).

The first practice slice teaches the eight natural notes from C4 through C5 in treble clef. A learner can play a real piano into the device microphone or use the on-screen keys. Pitch recognition is deterministic: audio frames stay in the browser and are classified with Pitchy. Per-note progress is kept in IndexedDB and scheduled with FSRS.

## Run locally

Prerequisites: Node.js 24.11 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3001` (or the URL shown in the terminal). On iPad, microphone access requires a secure HTTPS origin except when developing on localhost.

## Verify

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

## Deploy with Docker Compose

The production image uses Vinext's standalone output, runs as an unprivileged user, exposes a dedicated health endpoint, and works with a read-only root filesystem.

```bash
cp .env.example .env
docker compose build --pull
docker compose up -d
docker compose ps
```

By default, the service listens on `127.0.0.1:3000`. Put Caddy, Nginx, or another reverse proxy in front of it and provide HTTPS; iPadOS browsers require a secure origin before they will grant microphone access. To expose the container directly, set `OPENMEMO_CHORDS_BIND_ADDRESS=0.0.0.0` in `.env`, but HTTPS through a reverse proxy is strongly recommended.

Health check:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

Upgrade deployment:

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d --remove-orphans
docker image prune -f
```

Device learning progress remains in each browser's IndexedDB and is not stored in the container, so replacing the container does not erase learner data.

## Current scope

- responsive iPad, tablet, and mobile layout
- opening choice between a real-piano microphone mode and an on-screen-key mode
- oversized Level 1 notation stage focused on one note at a time
- VexFlow-rendered treble notation
- AudioWorklet microphone capture and Pitchy pitch detection
- steady-pitch and confidence gates to reduce accidental answers
- tappable, audible piano fallback
- gentle same-question correction and a short retry queue
- FSRS per-note long-term scheduling with device-local Dexie storage
- streak feedback and a winter-royal crystal celebration after each round
- installable web-app manifest

No recordings leave the browser. There is currently no user account, cloud sync, teacher dashboard, or service-worker offline cache.
