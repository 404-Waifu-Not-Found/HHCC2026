import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("library delete quest", () => {
  it("uses an explicit web confirm fallback before destructive delete", async () => {
    const source = await readFile(
      resolve(appRoot, "app/(tabs)/library.tsx"),
      "utf8",
    );

    expect(source).toContain('Platform.OS === "web"');
    expect(source).toContain('typeof window !== "undefined"');
    expect(source).toContain("window.confirm(");
    expect(source).toContain("if (confirmed) void deleteQuest(card);");
    expect(source).toContain("Alert.alert(t(\"deleteQuest\")");
  });
});
