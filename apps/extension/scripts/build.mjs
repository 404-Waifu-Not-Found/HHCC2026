import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import sharp from "sharp";
import { writeZipArchive } from "./zip-archive.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(root, "dist");
const stableExtensionOutput = resolve(
  outputRoot,
  "clipquest-captions-extension",
);
const appIcon = resolve(root, "../app/assets/brand/learning-prism.png");
const appBrandRoot = resolve(root, "../app/assets/brand");
const generatedIconRoot = resolve(root, "../app/assets/platform/extension");
const sharedEngineRoot = resolve(root, "../../packages/local-quiz-engine/src");
const sharedEngineFiles = new Set([
  "caption-text.js",
  "grounded-quality.js",
  "local-generator.js",
  "math-expression.js",
]);

mkdirSync(outputRoot, { recursive: true });
const stagingRoot = mkdtempSync(resolve(outputRoot, ".clipquest-build-"));
const extensionOutput = resolve(stagingRoot, "clipquest-captions-extension");
mkdirSync(resolve(extensionOutput, "icons"), { recursive: true });
mkdirSync(resolve(extensionOutput, "brand"), { recursive: true });

for (const file of ["manifest.json", "LICENSE", "NOTICE.md"]) {
  cpSync(resolve(root, file), resolve(extensionOutput, file));
}
for (const file of [
  "background.js",
  "bounded-response.js",
  "caption-core.js",
  "caption-text.js",
  "clipquest-bridge.js",
  "generation-outbox.js",
  "grounded-quality.js",
  "local-generator.js",
  "math-expression.js",
  "origin-policy.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "workplace-channel.js",
  "youtube-content.js",
  "youtube-page.js",
  "youtube-quick-open.css",
  "youtube-quick-open.js",
]) {
  cpSync(
    resolve(
      sharedEngineFiles.has(file) ? sharedEngineRoot : resolve(root, "src"),
      file,
    ),
    resolve(extensionOutput, file),
  );
}
for (const size of [16, 48, 128]) {
  const generated = resolve(generatedIconRoot, `icon-${size}.png`);
  cpSync(generated, resolve(extensionOutput, `icons/icon-${size}.png`));
}
for (const name of [
  "clipquest-lockup-on-light.png",
  "clipquest-lockup-on-dark.png",
]) {
  cpSync(resolve(appBrandRoot, name), resolve(extensionOutput, "brand", name));
}

// The Workplace chat orchestrator (`runWorkplaceChatTurn`) shares the same
// browser/platform-free source as the native clients, but it depends on the
// strict @clipquest/contracts schemas (and their zod runtime). The unpacked
// extension cannot resolve a bare module specifier, so bundle this one module
// into a self-contained ESM file that `workplace-channel.js` imports at runtime.
await esbuild({
  entryPoints: [resolve(sharedEngineRoot, "workplace-chat.js")],
  outfile: resolve(extensionOutput, "workplace-chat.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
});

const workplaceChatBundle = readFileSync(
  resolve(extensionOutput, "workplace-chat.js"),
  "utf8",
);
if (
  /from\s*["']@clipquest\/contracts["']/.test(workplaceChatBundle) ||
  !/runWorkplaceChatTurn/.test(workplaceChatBundle)
) {
  throw new Error(
    "The bundled Workplace orchestrator is missing or still references a bare module specifier.",
  );
}

const iconStats = await sharp(appIcon).stats();
const iconMetadata = await sharp(appIcon).metadata();
const { data: iconPixels, info: iconInfo } = await sharp(appIcon)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const iconCornerAlphaOffsets = [
  3,
  (iconInfo.width - 1) * iconInfo.channels + 3,
  (iconInfo.height - 1) * iconInfo.width * iconInfo.channels + 3,
  (iconInfo.width * iconInfo.height - 1) * iconInfo.channels + 3,
];
if (
  iconStats.entropy < 1 ||
  iconMetadata.hasAlpha !== true ||
  iconCornerAlphaOffsets.some((offset) => iconPixels[offset] !== 0)
) {
  throw new Error(
    "Canonical learning prism is blank or does not have a transparent background.",
  );
}

JSON.parse(readFileSync(resolve(extensionOutput, "manifest.json"), "utf8"));

const archive = resolve(outputRoot, "clipquest-captions-extension.zip");
rmSync(archive, { force: true });
rmSync(stableExtensionOutput, { recursive: true, force: true });
cpSync(extensionOutput, stableExtensionOutput, {
  recursive: true,
  force: true,
});
const archiveFiles = normalizeAndListFiles(stagingRoot, extensionOutput);
// Prefer the system `zip` CLI (identical bytes to the tracked release asset);
// fall back to the dependency-free writer whenever `zip` is missing or cannot
// run, such as on Windows developer machines, so dev:web, build, and e2e stay
// runnable. Consumers read build-info.json to learn which packager produced
// the archive.
let packager = "zip";
try {
  const zipped = spawnSync("zip", ["-X", "-q", archive, ...archiveFiles], {
    cwd: stagingRoot,
    stdio: "inherit",
  });
  if (zipped.error || zipped.status !== 0) {
    const reason = zipped.error
      ? `${zipped.error.code ?? zipped.error.name}: ${zipped.error.message}`
      : `zip exited with status ${zipped.status}`;
    console.warn(
      `zip CLI unavailable (${reason}); packaging with the built-in ZIP writer instead.`,
    );
    rmSync(archive, { force: true });
    writeZipArchive(archive, stagingRoot, archiveFiles);
    packager = "node";
  }
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
const archiveSha256 = createHash("sha256")
  .update(readFileSync(archive))
  .digest("hex");
writeFileSync(
  resolve(outputRoot, "build-info.json"),
  JSON.stringify(
    {
      archive: "clipquest-captions-extension.zip",
      packager,
      sha256: archiveSha256,
    },
    null,
    2,
  ),
);
console.log(
  `Built ${archive} (sha256 ${archiveSha256}, packaged with ${packager})`,
);

function normalizeAndListFiles(stagingDirectory, directory) {
  const normalizedTime = new Date("2020-01-01T00:00:00.000Z");
  const files = [];
  const visit = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const target = resolve(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        utimesSync(target, normalizedTime, normalizedTime);
        files.push(target.slice(stagingDirectory.length + 1));
      }
    }
    utimesSync(current, normalizedTime, normalizedTime);
  };
  visit(directory);
  return files.sort();
}
