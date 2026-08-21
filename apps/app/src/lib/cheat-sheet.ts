import {
  CheatSheetContextSchema,
  CheatSheetDocumentSchema,
  type CheatSheetContext,
  type CheatSheetDocument,
} from "@clipquest/contracts";
// Use pdf-lib's prebundled ESM artifact on Expo web/native. The package module
// entry imports tslib as a bare dependency, which Expo's web resolver exposes
// as an undefined default export during app bootstrap.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib/dist/pdf-lib.esm.js";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { apiBinaryRequest, apiRequest, ClientApiError, jsonBody } from "./api";
import { requestLocalCheatSheet } from "../generation/local-generation-client";

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
    if (section[1].length === 0) continue;
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
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await apiBinaryRequest(`/api/cheat-sheets/${sheetId}/file`);
      break;
    } catch (cause) {
      const retryable =
        cause instanceof ClientApiError &&
        cause.status === 404 &&
        (cause.code === "cheat_sheet_unavailable" ||
          cause.code === "cheat_sheet_not_ready" ||
          cause.code === "request_failed");
      if (!retryable || attempt === 2) throw cause;
      await new Promise((resolve) => setTimeout(resolve, [350, 900][attempt]));
    }
  }
  if (!response) throw new Error("The cheat sheet is not ready.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  await exportCheatSheetPdf(bytes, title);
}

/**
 * Export a locally rendered artifact without waiting for the private R2 sync.
 * This keeps the completion action useful when the upload is slow or a
 * transient sync error occurs; the server artifact can still be retried in the
 * background without regenerating the notes.
 */
export async function exportCheatSheetPdf(
  bytes: Uint8Array,
  title: string,
): Promise<void> {
  const filename = `${safeFilename(title).replace(/-cheat-sheet$/i, "") || "clipquest"}-cheat-sheet.pdf`;
  if (Platform.OS === "web") {
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const url = URL.createObjectURL(
      new Blob([blobBytes.buffer as ArrayBuffer], { type: "application/pdf" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return;
  }
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}${filename}`;
  await FileSystem.writeAsStringAsync(uri, toBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  // A simulator (and some managed Android profiles) can report that no
  // native share target is available. Do not silently swallow that state:
  // the learner needs an actionable failure instead of believing the PDF was
  // exported when only a cache file was written.
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Native sharing is unavailable on this device.");
  }
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
