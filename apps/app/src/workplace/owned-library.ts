// Shared, authenticated owned-library access for Workplace tools.
//
// Both the native tool services (`native-tool-services.ts`) and the web
// page-tool responder (`web-page-tools.ts`) resolve the learner's owned
// library the same way: through the account-scoped `/api/library` route.
// Keeping the fetch + ranking here means every platform searches owned videos
// by title with identical, bounded semantics and an empty library resolves to
// an empty result set rather than an error.
//
// Ownership is enforced server-side (the route is scoped to the signed-in
// user); this module only shapes and ranks the response for the tool layer.
import {
  LibraryResponseSchema,
  LibraryCardSchema,
  type LibraryCard,
} from "@clipquest/contracts";
import { apiRequest } from "../lib/api";
import type { WorkplaceLibraryVideo } from "./tool-executors";

/** Tokenize a free-text query into lowercased title-match terms. */
export function libraryQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .slice(0, 12);
}

export function libraryCardToWorkplaceVideo(
  card: LibraryCard,
): WorkplaceLibraryVideo {
  return {
    videoId: card.videoId,
    title: card.title,
    source: card.source,
    mastery: card.mastery,
    dueForReview: card.dueForReview,
    bestScore: card.bestScore,
    quizId: card.quizId,
  };
}

/**
 * The learner's owned library, deduplicated across the due/saved/suggestion
 * groupings the `/api/library` route returns.
 */
export async function fetchOwnedLibraryCards(
  signal?: AbortSignal,
): Promise<LibraryCard[]> {
  const response = await apiRequest("/api/library", { signal });
  const parsed = LibraryResponseSchema.safeParse(response);
  if (!parsed.success) {
    // One legacy card should not make the entire Workplace search unusable.
    // Keep only contract-valid, owned cards and let an empty result explain
    // itself to the model.
    const value =
      response && typeof response === "object"
        ? (response as Record<string, unknown>)
        : {};
    const groups = ["dueReviews", "saved", "youtubeSuggestions"];
    return groups.flatMap((key) => {
      const group = value[key];
      return Array.isArray(group)
        ? group.flatMap((card) => {
            const valid = LibraryCardSchema.safeParse(card);
            return valid.success ? [valid.data] : [];
          })
        : [];
    });
  }
  const responseData = parsed.data;
  const seen = new Set<string>();
  const cards: LibraryCard[] = [];
  for (const group of [
    responseData.dueReviews,
    responseData.saved,
    responseData.youtubeSuggestions,
  ]) {
    for (const card of group) {
      if (seen.has(card.videoId)) continue;
      seen.add(card.videoId);
      cards.push(card);
    }
  }
  return cards;
}

/**
 * Pure ranking: score owned cards by how many query terms match their title,
 * keep only matches (or every card when the query is empty), and return the
 * top `limit` as bounded Workplace metadata. Never throws -- an empty library
 * simply produces an empty array.
 */
export function rankOwnedLibrary(
  cards: readonly LibraryCard[],
  query: string,
  limit: number,
): WorkplaceLibraryVideo[] {
  const terms = libraryQueryTerms(query);
  const bounded = Math.max(1, Math.trunc(limit) || 1);
  const ranked =
    terms.length === 0
      ? [...cards]
      : cards
          .map((card) => ({
            card,
            score: terms.reduce(
              (total, term) =>
                card.title.toLowerCase().includes(term) ? total + 1 : total,
              0,
            ),
          }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.card);
  return ranked.slice(0, bounded).map(libraryCardToWorkplaceVideo);
}

/**
 * Search the learner's owned library by title, returning bounded metadata for
 * the best-matching owned videos. Handles an empty library gracefully.
 */
export async function searchOwnedLibrary(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<WorkplaceLibraryVideo[]> {
  const cards = await fetchOwnedLibraryCards(signal);
  return rankOwnedLibrary(cards, query, limit);
}
