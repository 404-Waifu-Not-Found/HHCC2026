import { apiRequest } from "../lib/api";
import { SpeechModelManifestSchema, type SpeechModelManifest } from "./types";

let cachedManifest: SpeechModelManifest | undefined;

export async function getSpeechModelManifest(): Promise<SpeechModelManifest> {
  cachedManifest ??= await apiRequest("/api/models/manifest", {}, SpeechModelManifestSchema);
  return cachedManifest;
}
