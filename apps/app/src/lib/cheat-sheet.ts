import {
  CheatSheetContextSchema,
  CheatSheetDocumentSchema,
  type CheatSheetContext,
  type CheatSheetDocument,
} from "@clipquest/contracts";
// Use pdf-lib's prebundled ESM artifact on Expo web/native. The package module
// entry imports tslib as a bare dependency, which Expo's web resolver exposes
// as an undefined default export during app bootstrap.
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib/dist/pdf-lib.esm.js";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { apiBinaryRequest, apiRequest, jsonBody } from "./api";
import { requestLocalCheatSheet } from "../generation/local-generation-client";

export function buildCheatSheetDocument(
  raw: CheatSheetContext,
): CheatSheetDocument {
  const context = CheatSheetContextSchema.parse(raw);
  const concepts = unique(
    context.questions
      .map((question) => question.prompt.replace(/[?!.].*$/, "").trim())
      .filter(Boolean),
  ).slice(0, 12);
  const definitions = context.questions.slice(0, 12).map((question) => ({
    term: question.prompt.slice(0, 100),
    definition: question.explanation.slice(0, 600),
  }));
  const formulas = context.questions
    .flatMap(
      (question) =>
        question.explanation.match(/[^.!?]*(?:=|\^|\+|-|\/)[^.!?]*/g) ?? [],
    )
    .slice(0, 10);
  return CheatSheetDocumentSchema.parse({
    title: context.title,
    source: context.source,
    summary:
      context.primer ||
      context.questions
        .map((question) => question.explanation)
        .join(" ")
        .slice(0, 2_000),
    keyConcepts: concepts,
    definitions,
    formulas,
    rememberThis: context.questions
      .slice(0, 6)
      .map((question) => question.explanation.slice(0, 300)),
    generatedAt: new Date().toISOString(),
    sourceRevision: context.sourceRevision,
  });
}

export async function generateCheatSheetDocumentWithLocalAi(
  context: CheatSheetContext,
  signal?: AbortSignal,
): Promise<CheatSheetDocument> {
  const generated = await requestLocalCheatSheet(context, signal);
  return CheatSheetDocumentSchema.parse({
    ...generated,
    generatedAt: new Date().toISOString(),
    sourceRevision: context.sourceRevision,
  });
}

export async function renderCheatSheetPdf(
  document: CheatSheetDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 748;
  const margin = 48;
  const width = 516;
  const nextPage = () => {
    page = pdf.addPage([612, 792]);
    y = 748;
  };
  const write = (
    text: string,
    size = 11,
    isBold = false,
    color = rgb(0.12, 0.2, 0.16),
  ) => {
    for (const line of wrap(text, size, width, isBold ? bold : font)) {
      if (y < 56) nextPage();
      page.drawText(line, {
        x: margin,
        y,
        size,
        font: isBold ? bold : font,
        color,
      });
      y -= size + 6;
    }
  };
  write(document.title, 24, true, rgb(0.08, 0.35, 0.2));
  write(
    `Source: ${document.source} · Generated ${new Date(document.generatedAt).toLocaleDateString()}`,
    9,
    false,
    rgb(0.35, 0.4, 0.37),
  );
  y -= 12;
  for (const section of [
    ["Summary", [document.summary]],
    ["Key concepts", document.keyConcepts.map((value) => `• ${value}`)],
    [
      "Definitions",
      document.definitions.map(
        (value) => `• ${value.term}: ${value.definition}`,
      ),
    ],
    ["Formulas / math", document.formulas.map((value) => `• ${value}`)],
    ["Remember this", document.rememberThis.map((value) => `• ${value}`)],
  ] as const) {
    write(section[0], 15, true, rgb(0.1, 0.25, 0.16));
    for (const item of section[1]) write(item, 11);
    y -= 8;
  }
  return pdf.save();
}

export async function exportCheatSheet(
  sheetId: string,
  title: string,
): Promise<void> {
  const response = await apiBinaryRequest(`/api/cheat-sheets/${sheetId}/file`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const filename = `${safeFilename(title)}-cheat-sheet.pdf`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return;
  }
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}${filename}`;
  await FileSystem.writeAsStringAsync(uri, toBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: title,
    });
}

export async function loadCheatSheetContext(
  quizId: string,
): Promise<CheatSheetContext> {
  return apiRequest(
    `/api/quizzes/${quizId}/cheat-sheet-context`,
    {},
    CheatSheetContextSchema,
  );
}

export async function uploadCheatSheet(input: {
  videoId: string;
  quizId: string;
  document: CheatSheetDocument;
  pdf: Uint8Array;
}): Promise<{ id: string }> {
  const binary = toBase64(input.pdf);
  const contentHash = simpleHash(binary);
  const response = await apiRequest("/api/cheat-sheets", {
    method: "POST",
    body: jsonBody({
      videoId: input.videoId,
      quizId: input.quizId,
      sourceRevision: input.document.sourceRevision,
      document: input.document,
      pdfBase64: binary,
      contentHash,
      promptVersion: "cheat-sheet-v1",
    }),
  });
  return response as { id: string };
}

export async function recordCheatSheetFailure(input: {
  videoId: string;
  quizId: string;
  sourceRevision: string;
  lastError: string;
}): Promise<void> {
  await apiRequest("/api/cheat-sheets/failure", {
    method: "POST",
    body: jsonBody({ ...input, promptVersion: "cheat-sheet-v1" }),
  });
}

function wrap(
  text: string,
  size: number,
  maxWidth: number,
  font: { widthOfTextAtSize(text: string, size: number): number },
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function safeFilename(value: string): string {
  return (
    value
      .replace(/[^a-z0-9 _-]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "clipquest"
  );
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function simpleHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
