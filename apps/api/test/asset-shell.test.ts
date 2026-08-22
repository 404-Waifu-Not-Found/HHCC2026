import { describe, expect, it } from "vitest";
import { preventStaleAppShell, publicAssetShell } from "../src/lib/asset-shell";

describe("public route asset shells", () => {
  it("maps extensionless static URLs to their exported Expo pages", () => {
    expect(publicAssetShell("/")).toBe("/index.html");
    expect(publicAssetShell("/welcome")).toBe("/welcome.html");
    expect(publicAssetShell("/sign-up/")).toBe("/sign-up.html");
    expect(publicAssetShell("/admin")).toBe("/admin/index.html");
    expect(publicAssetShell("/admin/users/")).toBe("/admin/users.html");
  });

  it("maps dynamic navigation URLs to their exported Expo shells", () => {
    expect(publicAssetShell("/create/video-id")).toBe("/create/[videoId].html");
    expect(publicAssetShell("/generation/video-id/")).toBe(
      "/generation/[videoId].html",
    );
    expect(publicAssetShell("/quiz/attempt-id")).toBe("/quiz/[attemptId].html");
    expect(publicAssetShell("/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a")).toBe(
      "/s/[token].html",
    );
    expect(publicAssetShell("/s/token/")).toBe("/s/[token].html");
  });

  it("does not rewrite nested, empty, or unrelated paths", () => {
    expect(publicAssetShell("/create/")).toBeNull();
    expect(publicAssetShell("/create/video-id/extra")).toBeNull();
    expect(publicAssetShell("/library/video-id")).toBeNull();
    expect(publicAssetShell("/s/")).toBeNull();
    expect(publicAssetShell("/s/token/extra")).toBeNull();
    expect(publicAssetShell("/settings")).toBe("/settings.html");
  });

  it("prevents browsers from retaining an app shell across deployments", async () => {
    const response = preventStaleAppShell(
      new Response("shell", {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          ETag: '"old-shell"',
        },
      }),
      {
        versionId: "873e0843-ab3b-4a2a-9d0d-4581dcceb810",
        versionTag: "release-sha",
      },
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-ClipQuest-Worker-Version")).toBe(
      "873e0843-ab3b-4a2a-9d0d-4581dcceb810",
    );
    expect(response.headers.get("X-ClipQuest-Worker-Tag")).toBe("release-sha");
    expect(response.headers.get("ETag")).toBe('"old-shell"');
    expect(await response.text()).toBe("shell");
  });
});
