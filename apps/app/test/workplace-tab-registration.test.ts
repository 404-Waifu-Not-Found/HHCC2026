import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

function source(path: string) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

describe("Workplace tab registration", () => {
  it("keeps Workplace hidden behind the release gate", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    expect(layout).toContain("workplaceEnabled");
    expect(layout).toContain("href: workplaceEnabled ? undefined : null");
    expect(layout).toContain(
      'if (route.name === "workplace" && !workplaceEnabled) return null;',
    );
  });

  it("gives the Workplace tab its own icon and localized title", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    expect(layout).toContain('title: t("workplace")');
    expect(layout).toContain('<VoxelIcon name="workplace"');
  });

  it("gates every tab, including Workplace, behind the shared sign-in redirect", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    expect(layout).toContain(
      'if (!data) return <Redirect href="/(auth)/sign-in" />;',
    );
  });

  it("defines the Workplace screen module the tab routes to", () => {
    const workplace = source("app/(tabs)/workplace.tsx");
    expect(workplace).toContain("export default function WorkplaceScreen()");
    expect(workplace).toContain('Redirect href="/(tabs)/library"');
  });

  it("registers the workplace icon in the shared Voxel icon set", () => {
    const icons = source("src/theme/voxel-icons.ts");
    expect(icons).toContain('"workplace"');
  });
});
