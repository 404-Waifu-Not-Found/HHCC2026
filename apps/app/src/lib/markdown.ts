// A small, dependency-free Markdown parser for the Workplace assistant surface.
//
// The assistant streams untrusted model text; this parser turns a safe subset
// of Markdown into a structured tree the `Markdown` component renders with
// React Native primitives. It never interprets HTML (angle brackets are plain
// text), never executes anything, and degrades gracefully on the partial input
// produced mid-stream (an unterminated code fence or emphasis run is rendered
// as best it can rather than throwing).
//
// Supported: ATX headings (`#`..`######`), paragraphs, unordered lists
// (`-`/`*`/`+`), ordered lists (`1.`), fenced code blocks (```), inline bold
// (`**`/`__`), italic (`*`/`_`), inline code (`` ` ``), links (`[text](url)`),
// and hard line breaks inside a paragraph.

export type MarkdownInlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: MarkdownInlineNode[] }
  | { type: "emphasis"; children: MarkdownInlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; label: MarkdownInlineNode[]; href: string }
  | { type: "break" };

export type MarkdownBlock =
  | { type: "heading"; level: number; children: MarkdownInlineNode[] }
  | { type: "paragraph"; children: MarkdownInlineNode[] }
  | {
      type: "list";
      ordered: boolean;
      start: number;
      items: MarkdownInlineNode[][];
    }
  | { type: "code"; value: string; lang?: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;

/** Parse a Markdown document into a flat list of block nodes. */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    if (text) {
      blocks.push({ type: "paragraph", children: parseInline(text) });
    }
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = line.match(FENCE);
    if (fence) {
      flushParagraph();
      const marker = fence[1]!;
      const lang = fence[2] || undefined;
      const body: string[] = [];
      i += 1;
      // Consume until the matching closing fence, or the end of input for a
      // still-streaming, unterminated block.
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) {
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ type: "code", value: body.join("\n"), lang });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1]!.length,
        children: parseInline(heading[2]!.trim()),
      });
      continue;
    }

    const unordered = line.match(UNORDERED);
    const ordered = line.match(ORDERED);
    if (unordered || ordered) {
      flushParagraph();
      const listOrdered = Boolean(ordered);
      const start = ordered ? Number(ordered[1]) : 1;
      const items: MarkdownInlineNode[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const u = current.match(UNORDERED);
        const o = current.match(ORDERED);
        if (listOrdered && o) items.push(parseInline(o[2]!.trim()));
        else if (!listOrdered && u) items.push(parseInline(u[1]!.trim()));
        else break;
        i += 1;
      }
      i -= 1;
      blocks.push({ type: "list", ordered: listOrdered, start, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function pushText(nodes: MarkdownInlineNode[], value: string) {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last && last.type === "text") last.value += value;
  else nodes.push({ type: "text", value });
}

/**
 * Parse inline Markdown into a node tree. Hard line breaks become `break`
 * nodes. Unmatched delimiters are emitted as literal text so partial streaming
 * output never disappears.
 */
export function parseInline(input: string): MarkdownInlineNode[] {
  const nodes: MarkdownInlineNode[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;

    // Backslash escape: the next character is always literal.
    if (char === "\\" && i + 1 < input.length) {
      pushText(nodes, input[i + 1]!);
      i += 2;
      continue;
    }

    if (char === "\n") {
      nodes.push({ type: "break" });
      i += 1;
      continue;
    }

    // Inline code: literal run between single backticks.
    if (char === "`") {
      const end = input.indexOf("`", i + 1);
      if (end !== -1) {
        nodes.push({ type: "code", value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Link: [label](href). Label is parsed inline; href is taken literally.
    if (char === "[") {
      const link = matchLink(input, i);
      if (link) {
        nodes.push({
          type: "link",
          label: parseInline(link.label),
          href: link.href,
        });
        i = link.end;
        continue;
      }
    }

    // Strong: ** or __.
    if (char === "*" || char === "_") {
      const doubled = input[i + 1] === char;
      const delimiter = doubled ? char + char : char;
      const end = findClosingDelimiter(input, i + delimiter.length, delimiter);
      if (end !== -1) {
        const inner = input.slice(i + delimiter.length, end);
        nodes.push({
          type: doubled ? "strong" : "emphasis",
          children: parseInline(inner),
        });
        i = end + delimiter.length;
        continue;
      }
    }

    pushText(nodes, char);
    i += 1;
  }

  return nodes;
}

function matchLink(
  input: string,
  start: number,
): { label: string; href: string; end: number } | null {
  const labelEnd = input.indexOf("]", start + 1);
  if (labelEnd === -1 || input[labelEnd + 1] !== "(") return null;
  const hrefEnd = input.indexOf(")", labelEnd + 2);
  if (hrefEnd === -1) return null;
  return {
    label: input.slice(start + 1, labelEnd),
    href: input.slice(labelEnd + 2, hrefEnd).trim(),
    end: hrefEnd + 1,
  };
}

function findClosingDelimiter(
  input: string,
  from: number,
  delimiter: string,
): number {
  // The opening delimiter must be followed by content, and the closing run
  // must not be immediately preceded by whitespace (keeps `a * b * c` literal).
  if (input[from] === undefined || input[from] === " ") return -1;
  let i = from;
  while (i < input.length) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (
      input.startsWith(delimiter, i) &&
      input[i - 1] !== " " &&
      input[i - 1] !== undefined
    ) {
      return i;
    }
    i += 1;
  }
  return -1;
}
