import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Library card share action", () => {
  it("renders a share action only for cards with a quiz and wires it through the Library", () => {
    const card = readFileSync(
      resolve(import.meta.dirname, "../src/components/VideoCard.tsx"),
      "utf8",
    );
    expect(card).toContain("onShare?(): void | Promise<void>;");
    expect(card).toContain("sharePending?: boolean;");
    expect(card).toContain("testID={`video-card-share-${card.videoId}`}");
    expect(card).toContain('<VoxelIcon name="link" size={18} />');

    const library = readFileSync(
      resolve(import.meta.dirname, "../app/(tabs)/library.tsx"),
      "utf8",
    );
    expect(library).toContain(
      "onShare={card.quizId ? () => onShare(card) : undefined}",
    );
    expect(library).toContain('testID="library-share-notice"');
  });
});
