import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

function source(path: string) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

describe("Workplace tab registration", () => {
  it("registers the Workplace tab between Library and Settings", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    const libraryIndex = layout.indexOf('name="library"');
    const workplaceIndex = layout.indexOf('name="workplace"');
    const settingsIndex = layout.indexOf('name="settings"');

    expect(libraryIndex).toBeGreaterThan(-1);
    expect(workplaceIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(workplaceIndex).toBeGreaterThan(libraryIndex);
    expect(workplaceIndex).toBeLessThan(settingsIndex);
  });

  it("gives the Workplace tab its own icon and localized title", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    const workplaceBlock = layout.slice(
      layout.indexOf('name="workplace"'),
      layout.indexOf('name="settings"'),
    );
    expect(workplaceBlock).toContain('title: t("workplace")');
    expect(workplaceBlock).toContain('<VoxelIcon name="workplace"');
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
  });

  it("registers the workplace icon in the shared Voxel icon set", () => {
    const icons = source("src/theme/voxel-icons.ts");
    expect(icons).toContain('"workplace"');
  });
});
