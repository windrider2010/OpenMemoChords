import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production container uses the standalone, non-root runtime", async () => {
  const [dockerfile, compose, nextConfig, dockerignore] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../compose.yaml", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  ]);

  assert.match(nextConfig, /output:\s*"standalone"/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS runtime/);
  assert.match(dockerfile, /COPY --from=builder --chown=node:node \/app\/dist\/standalone\//);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /\/api\/health/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /name: openmemo-chords/);
  assert.match(compose, /openmemo-chords:latest/);
  assert.match(compose, /127\.0\.0\.1/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /tmpfs:/);
  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^\.env$/m);
});
