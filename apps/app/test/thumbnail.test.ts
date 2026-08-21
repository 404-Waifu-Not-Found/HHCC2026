import { describe, expect, it } from "vitest";
import {
  THUMBNAIL_RETRY_DELAYS_MS,
  thumbnailRetryDelay,
  thumbnailUriForAttempt,
} from "../src/lib/thumbnail";

describe("reliable thumbnails", () => {
  it("keeps the canonical URL for the first request", () => {
    expect(
      thumbnailUriForAttempt(
        "https://clipquest.ccwu.cc/api/videos/video-id/thumbnail",
        0,
      ),
    ).toBe("https://clipquest.ccwu.cc/api/videos/video-id/thumbnail");
  });

  it("cache-busts retries without dropping existing parameters", () => {
    const retry = new URL(
      thumbnailUriForAttempt(
        "https://clipquest.ccwu.cc/api/videos/video-id/thumbnail?variant=wide",
        2,
      ),
    );
    expect(retry.searchParams.get("variant")).toBe("wide");
    expect(retry.searchParams.get("cq_thumbnail_retry")).toBe("2");
  });

  it("uses three bounded automatic retries before manual recovery", () => {
    expect(THUMBNAIL_RETRY_DELAYS_MS).toEqual([400, 1_200, 3_000]);
    expect(thumbnailRetryDelay(0)).toBe(400);
    expect(thumbnailRetryDelay(2)).toBe(3_000);
    expect(thumbnailRetryDelay(3)).toBeNull();
  });
});
