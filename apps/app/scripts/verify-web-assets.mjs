import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const verificationOrigin = "https://clipquest.local";
const allowedOrigins = new Set([
  verificationOrigin,
  "https://clipquest.ccwu.cc",
]);

export async function verifyWebAssetGraph(outputDirectory = "dist") {
  const root = path.resolve(outputDirectory);
  const htmlFiles = await findHtmlFiles(root);
  if (htmlFiles.length === 0) {
    throw new Error(`No generated HTML shells were found in ${root}.`);
  }

  const missing = [];
  let checkedReferences = 0;
  for (const htmlFile of htmlFiles) {
    const source = await readFile(htmlFile, "utf8");
    const relativeHtml = path.relative(root, htmlFile);
    for (const reference of extractAssetReferences(source)) {
      const resolved = resolveSameOriginReference(
        reference.value,
        relativeHtml,
        root,
      );
      if (!resolved) continue;
      checkedReferences += 1;
      if (!(await isFile(resolved.absolutePath))) {
        missing.push({
          html: relativeHtml,
          kind: reference.kind,
          value: reference.value,
          expected: path.relative(root, resolved.absolutePath),
        });
      }
    }
  }

  if (missing.length > 0) {
    const details = missing
      .map(
        (item) =>
          `${item.html}: ${item.kind} ${JSON.stringify(item.value)} -> ${item.expected}`,
      )
      .join("\n");
    throw new Error(
      `Generated HTML references ${missing.length} missing same-origin asset(s):\n${details}`,
    );
  }
  return { htmlFiles: htmlFiles.length, checkedReferences };
}

export function extractAssetReferences(source) {
  const references = [];
  const tagPattern = /<(script|link|img|source|image|video|input)\b[^>]*>/giu;
  for (const match of source.matchAll(tagPattern)) {
    const tagName = match[1].toLowerCase();
    const attributes = parseAttributes(match[0]);
    if (tagName === "script") {
      addAttribute(references, "script", attributes, "src");
      continue;
    }
    if (tagName === "link") {
      const rel = (attributes.get("rel") ?? "").toLowerCase();
      const as = (attributes.get("as") ?? "").toLowerCase();
      if (
        /(?:^|\s)(?:modulepreload|stylesheet|manifest|icon|apple-touch-icon)(?:\s|$)/u.test(
          rel,
        ) ||
        (/(?:^|\s)preload(?:\s|$)/u.test(rel) &&
          ["font", "image", "script", "style"].includes(as))
      ) {
        addAttribute(references, `link:${rel || as}`, attributes, "href");
      }
      continue;
    }
    if (tagName === "video") {
      addAttribute(references, "video-poster", attributes, "poster");
      continue;
    }
    addAttribute(references, tagName, attributes, "src");
    addSrcset(references, tagName, attributes.get("srcset"));
    addAttribute(references, tagName, attributes, "href");
    addAttribute(references, tagName, attributes, "xlink:href");
  }

  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    if (match[2]) references.push({ kind: "css-url", value: match[2] });
  }
  return references;
}

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(
      match[1].toLowerCase(),
      decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    );
  }
  return attributes;
}

function addAttribute(references, kind, attributes, name) {
  const value = attributes.get(name);
  if (value) references.push({ kind, value });
}

function addSrcset(references, kind, value) {
  if (!value) return;
  for (const candidate of value.split(",")) {
    const url = candidate.trim().split(/\s+/u)[0];
    if (url) references.push({ kind: `${kind}-srcset`, value: url });
  }
}

function resolveSameOriginReference(value, relativeHtml, root) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^(?:data|blob|javascript|mailto|tel):/iu.test(trimmed)
  ) {
    return null;
  }

  let url;
  try {
    const htmlUrl = new URL(
      `/${relativeHtml.split(path.sep).map(encodeURIComponent).join("/")}`,
      verificationOrigin,
    );
    url = new URL(trimmed, htmlUrl);
  } catch {
    return null;
  }
  if (!allowedOrigins.has(url.origin)) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    decodedPath = url.pathname;
  }
  const absolutePath = path.resolve(root, `.${decodedPath}`);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${relativeHtml} contains an asset path outside the build directory: ${value}`,
    );
  }
  return { absolutePath };
}

async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return findHtmlFiles(target);
      return entry.isFile() && entry.name.endsWith(".html") ? [target] : [];
    }),
  );
  return nested.flat().sort();
}

async function isFile(target) {
  try {
    return (await lstat(target)).isFile();
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const result = await verifyWebAssetGraph(process.argv[2] ?? "dist");
  process.stdout.write(
    `Verified ${result.checkedReferences} asset references across ${result.htmlFiles} HTML shells.\n`,
  );
}
