import { describe, expect, it } from "vitest";
import { assertMediaSourceAllowed } from "../src/routes/media";

describe("media boundary", () => {
  it("allows only YouTube through the transient no-store media route", () => {
    expect(() => assertMediaSourceAllowed("youtube")).not.toThrow();
    expect(() => assertMediaSourceAllowed("vimeo")).toThrow();
  });
});
