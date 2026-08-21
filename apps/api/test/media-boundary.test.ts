import { describe, expect, it } from "vitest";
import { assertMediaSourceAllowed } from "../src/routes/media";

describe("media boundary", () => {
  it("blocks every YouTube media request while preserving bilibili", () => {
    expect(() => assertMediaSourceAllowed("youtube")).toThrow(
      "captured and transcribed privately",
    );
    expect(() => assertMediaSourceAllowed("bilibili")).not.toThrow();
  });
});
