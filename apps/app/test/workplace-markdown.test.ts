import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks, parseInline } from "../src/lib/markdown";

describe("Workplace Markdown parsing", () => {
  it("renders common assistant formatting as structured blocks", () => {
    const blocks = parseMarkdownBlocks(
      "# Key idea\n\nUse **bold** and *emphasis*.\n\n- First\n- Second\n\n```ts\nconst answer = 42;\n```",
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "code",
    ]);
    expect(blocks[2]).toMatchObject({
      type: "list",
      ordered: false,
      items: [
        [{ type: "text", value: "First" }],
        [{ type: "text", value: "Second" }],
      ],
    });
    expect(blocks[3]).toMatchObject({ type: "code", lang: "ts" });
  });

  it("keeps partial streaming delimiters visible", () => {
    expect(parseInline("Still **typing")).toEqual([
      { type: "text", value: "Still **typing" },
    ]);
    expect(parseMarkdownBlocks("```js\nconst value = 1;")).toMatchObject([
      { type: "code", lang: "js", value: "const value = 1;" },
    ]);
  });

  it("does not interpret HTML as markup", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { type: "text", value: "<script>alert(1)</script>" },
    ]);
  });
});
