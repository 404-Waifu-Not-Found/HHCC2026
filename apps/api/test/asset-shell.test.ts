import { describe, expect, it } from "vitest";
import { publicAssetShell } from "../src/lib/asset-shell";

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
  });

  it("does not rewrite nested, empty, or unrelated paths", () => {
    expect(publicAssetShell("/create/")).toBeNull();
    expect(publicAssetShell("/create/video-id/extra")).toBeNull();
    expect(publicAssetShell("/library/video-id")).toBeNull();
  });
});
