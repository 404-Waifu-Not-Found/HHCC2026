import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyWebAssetGraph } from "./verify-web-assets.mjs";

test("accepts recursively nested shells whose same-origin assets exist", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "nested"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "entry.js"), "export {};");
    await writeFile(path.join(root, "assets", "font.woff2"), "font");
    await writeFile(path.join(root, "assets", "image.png"), "image");
    await writeFile(
      path.join(root, "nested", "index.html"),
      `<script src="/assets/entry.js?v=1"></script>
       <link rel="preload" as="font" href="/assets/font.woff2">
       <style>.hero{background:url('/assets/image.png')}</style>`,
    );
    assert.deepEqual(await verifyWebAssetGraph(root), {
      htmlFiles: 1,
      checkedReferences: 3,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a shell references a removed hashed bundle", async () => {
  const root = await fixture();
  try {
    await writeFile(
      path.join(root, "index.html"),
      '<script type="module" src="/_expo/static/js/web/entry-removed.js"></script>',
    );
    await assert.rejects(verifyWebAssetGraph(root), /entry-removed\.js/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), "clipquest-asset-graph-"));
}
