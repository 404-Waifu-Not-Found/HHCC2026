import { cpSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const extensionRoot = resolve(workspaceRoot, "apps/extension");
execFileSync(process.execPath, [resolve(extensionRoot, "scripts/build.mjs")], {
  cwd: extensionRoot,
  stdio: "inherit",
});

const builtArchive = resolve(
  extensionRoot,
  "dist/clipquest-captions-extension.zip",
);
const trackedArchive = resolve(
  appRoot,
  "public/clipquest-captions-extension.zip",
);
const buildInfoPath = resolve(extensionRoot, "dist/build-info.json");
const packager = existsSync(buildInfoPath)
  ? JSON.parse(readFileSync(buildInfoPath, "utf8")).packager
  : "zip";

// The tracked public archive is a release asset whose bytes are produced by
// the `zip` CLI. When the extension was packaged by the built-in fallback
// (no `zip` on this machine) the contents match but the bytes differ, so keep
// the tracked asset untouched instead of dirtying the working tree. Local
// extension changes are loaded unpacked from apps/extension/dist anyway.
if (packager !== "zip" && existsSync(trackedArchive)) {
  console.log(
    "Keeping the tracked extension archive; the local build used the built-in ZIP writer.",
  );
} else {
  cpSync(builtArchive, trackedArchive);
}
