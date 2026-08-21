import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  probeWorkerAssetShells,
  productionShellPaths,
  retryWorkerAssetProbe,
} from "./probe-worker-assets.mjs";

test("probes every shell and its version-pinned entry bundle", async () => {
  const versionId = "873e0843-ab3b-4a2a-9d0d-4581dcceb810";
  const server = createServer((request, response) => {
    assert.equal(
      request.headers["cloudflare-workers-version-overrides"],
      `clipquest="${versionId}"`,
    );
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          worker: { versionId, versionTag: "test" },
          versionAffinity: { requestKeyPresent: true },
        }),
      );
      return;
    }
    if (url.pathname === "/_expo/static/js/web/entry-test.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end("export {};");
      return;
    }
    if (productionShellPaths.includes(url.pathname)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-ClipQuest-Worker-Version", versionId);
      response.end(
        '<script type="module" src="/_expo/static/js/web/entry-test.js"></script>',
      );
      return;
    }
    response.statusCode = 404;
    response.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const result = await probeWorkerAssetShells({
      origin: `http://127.0.0.1:${address.port}`,
      versionId,
      requireAffinity: true,
    });
    assert.equal(result.shells, productionShellPaths.length);
    assert.equal(result.bundles, productionShellPaths.length);
    assert.equal(result.versionAffinityPresent, true);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("waits through bounded version-override propagation", async () => {
  let probeCalls = 0;
  let sleeps = 0;
  const result = await retryWorkerAssetProbe(
    { versionId: "new-version" },
    {
      attempts: 8,
      delayMs: 3_000,
      probe: async () => {
        probeCalls += 1;
        if (probeCalls < 7) throw new Error("version not propagated");
        return { workerVersion: { versionId: "new-version" } };
      },
      sleep: async (milliseconds) => {
        assert.equal(milliseconds, 3_000);
        sleeps += 1;
      },
    },
  );

  assert.deepEqual(result, {
    workerVersion: { versionId: "new-version" },
  });
  assert.equal(probeCalls, 7);
  assert.equal(sleeps, 6);
});
