// Lightweight, per-device tracking of how many messages a learner has seen
// in each Workplace thread, so the thread rail can show an unread badge.
// This is deliberately NOT synced to the server: unread state is a per-device
// affordance, not learning-progress data.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const WORKPLACE_READ_STATE_KEY = "clipquest:workplace-read:v1";

export type WorkplaceReadState = Readonly<Record<string, number>>;

export async function loadWorkplaceReadState(): Promise<WorkplaceReadState> {
  try {
    const raw = await AsyncStorage.getItem(WORKPLACE_READ_STATE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[0] === "string" && typeof entry[1] === "number",
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export async function saveWorkplaceReadState(
  state: WorkplaceReadState,
): Promise<void> {
  await AsyncStorage.setItem(WORKPLACE_READ_STATE_KEY, JSON.stringify(state));
}

/** Pure merge: records that `threadId` has been read through
 * `messageCount` messages. Never moves the read count backwards. */
export function markThreadRead(
  state: WorkplaceReadState,
  threadId: string,
  messageCount: number,
): WorkplaceReadState {
  const current = state[threadId] ?? 0;
  if (messageCount <= current) return state;
  return { ...state, [threadId]: messageCount };
}

export function forgetThreadReadState(
  state: WorkplaceReadState,
  threadId: string,
): WorkplaceReadState {
  if (!(threadId in state)) return state;
  const next = { ...state };
  delete next[threadId];
  return next;
}
