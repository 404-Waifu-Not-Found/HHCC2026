import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("dist");
const expoHydrationScript = "globalThis.__EXPO_ROUTER_HYDRATE__=true;";
const hardenedHydrationScript =
  "globalThis.__zod_globalConfig={jitless:true};globalThis.__EXPO_ROUTER_HYDRATE__=true;";

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(target);
      if (!entry.name.endsWith(".html")) return;

      const source = await readFile(target, "utf8");
      const hardened = source
        .replaceAll("/assets/__node_modules/@", "/assets/__node_modules/%40")
        .replaceAll(expoHydrationScript, hardenedHydrationScript);
      if (hardened !== source) await writeFile(target, hardened);
    }),
  );
}

await visit(outputDirectory);

const webBundleDirectory = path.join(
  outputDirectory,
  "_expo",
  "static",
  "js",
  "web",
);
const webBundleEntries = await readdir(webBundleDirectory);
const entryBundle = webBundleEntries.find((entry) =>
  /^entry-[a-f0-9]+\.js$/.test(entry),
);
if (!entryBundle) throw new Error("Expo's web entry bundle was not found.");
const entryBundleBytes = await readFile(
  path.join(webBundleDirectory, entryBundle),
);
const entryBundleVersion = createHash("sha256")
  .update(entryBundleBytes)
  .digest("hex")
  .slice(0, 16);
const entryBundleSource = `src="/_expo/static/js/web/${entryBundle}"`;
const versionedEntryBundleSource = `${entryBundleSource.slice(0, -1)}?v=${entryBundleVersion}"`;

async function versionEntryBundle(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return versionEntryBundle(target);
      if (!entry.name.endsWith(".html")) return;
      const source = await readFile(target, "utf8");
      const versioned = source.replaceAll(
        entryBundleSource,
        versionedEntryBundleSource,
      );
      if (versioned !== source) await writeFile(target, versioned);
    }),
  );
}

await versionEntryBundle(outputDirectory);

const indexHtml = await readFile(
  path.join(outputDirectory, "index.html"),
  "utf8",
);
const hydrationMatch = indexHtml.match(
  /<script type="module">([^<]*__EXPO_ROUTER_HYDRATE__[^<]*)<\/script>/,
);
if (!hydrationMatch)
  throw new Error("Expo hydration script was not found in the web export.");
const hydrationHash = createHash("sha256")
  .update(hydrationMatch[1])
  .digest("base64");
const headers = await readFile(path.join(outputDirectory, "_headers"), "utf8");
if (!headers.includes(`'sha256-${hydrationHash}'`)) {
  throw new Error(
    "The Content Security Policy hash does not match Expo's hydration script.",
  );
}

await copyFile(
  path.join(outputDirectory, "+not-found.html"),
  path.join(outputDirectory, "404.html"),
);
