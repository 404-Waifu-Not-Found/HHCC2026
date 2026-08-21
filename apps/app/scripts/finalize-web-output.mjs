import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("dist");

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(target);
      if (!entry.name.endsWith(".html")) return;

      const source = await readFile(target, "utf8");
      const encoded = source.replaceAll("/assets/__node_modules/@", "/assets/__node_modules/%40");
      if (encoded !== source) await writeFile(target, encoded);
    }),
  );
}

await visit(outputDirectory);
