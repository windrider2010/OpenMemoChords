import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the piano application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>OpenMemoChords<\/title>/i);
  assert.match(html, /Warming up the piano/);
  assert.match(html, /PianoTrainer-[^"']+\.js/);
});

test("exposes an uncached production health endpoint", async () => {
  const response = await render("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok", service: "openmemo-chords" });
});

test("ships the focused adaptive curriculum and progress experience", async () => {
  const [page, layout, css, packageJson, trainer, dashboard, curriculum, progress, pitch, staff, notes, worklet, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PianoTrainer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProgressDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/curriculum.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/progress.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/usePitchDetector.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/StaffNote.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/notes.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/audio/pitch-worklet.js", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<PianoTrainer \/>/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(css, /\.notation-stage/);
  assert.match(css, /min-height:\s*clamp\(330px, 49vh, 560px\)/);
  assert.match(css, /\.winter-celebration/);
  assert.match(css, /\.snowflake-border/);
  assert.match(css, /\.dashboard-shell/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /\.snowfall\s*\{/);
  assert.match(trainer, /recordMistake/);
  assert.match(trainer, /ratingForAnswer/);
  assert.match(trainer, /Have a Piano/);
  assert.match(trainer, /No Piano/);
  assert.match(trainer, /practiceMode === "virtual"/);
  assert.match(trainer, /Play this note/);
  assert.match(trainer, /Start listening/);
  assert.match(trainer, /Crystal Crown earned!/);
  assert.match(trainer, /Noise guard on/);
  assert.match(trainer, /Start the beat/);
  assert.match(trainer, /ProgressDashboard/);
  assert.match(dashboard, /Accuracy journey/);
  assert.match(dashboard, /Reset all stats/);
  assert.match(dashboard, /Crystal palace/);
  assert.match(curriculum, /Quarter and half notes/);
  assert.match(curriculum, /Short stepwise melodies/);
  assert.match(curriculum, /Treble and bass journeys/);
  assert.match(progress, /this\.version\(2\)/);
  assert.match(progress, /resetAllStats/);
  assert.match(progress, /pointsForAnswer/);
  assert.match(pitch, /noiseFloorRef/);
  assert.match(pitch, /centsSpread/);
  assert.match(pitch, /createBiquadFilter/);
  assert.match(staff, /note\.id === "C4"/);
  assert.match(staff, /setKeyLine\(0, 0\)/);
  assert.match(notes, /id: "C4", midi: 60, vexKey: "c\/4"/);
  assert.match(notes, /short ledger line below the staff/);
  assert.match(worklet, /registerProcessor\("pitch-frame-processor"/);
  assert.match(manifest, /"display": "standalone"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../LICENSE", import.meta.url));
});
