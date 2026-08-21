import { cpSync } from "node:fs";
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
cpSync(
  resolve(extensionRoot, "dist/clipquest-captions-extension.zip"),
  resolve(appRoot, "public/clipquest-captions-extension.zip"),
);
