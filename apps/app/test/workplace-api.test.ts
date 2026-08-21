import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/lib/auth-client", () => ({
  authClient: { getCookie: () => "" },
}));
vi.mock("../src/lib/config", () => ({
  API_ORIGIN: "https://clipquest.test",
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => globalThis.crypto.randomUUID(),
}));

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD_ID,
    title: "Calculus review",
    messageCount: 0,
    lastMessageAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Workplace REST client", () => {
  it("lists threads from GET /api/workplace/threads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ threads: [thread()] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listWorkplaceThreads } = await import("../src/workplace/api");

    const threads = await listWorkplaceThreads();

    expect(threads).toEqual([thread()]);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://clipquest.test/api/workplace/threads");
    expect(options.method).toBeUndefined();
  });

  it("creates a thread via POST with an optional title", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ thread: thread({ title: "New" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { createWorkplaceThread } = await import("../src/workplace/api");

    const created = await createWorkplaceThread("New");

    expect(created.title).toBe("New");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://clipquest.test/api/workplace/threads");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ title: "New" });
  });

  it("renames a thread via PATCH", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ thread: thread({ title: "Renamed" }) }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { renameWorkplaceThread } = await import("../src/workplace/api");

    const renamed = await renameWorkplaceThread(THREAD_ID, "Renamed");

    expect(renamed.title).toBe("Renamed");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://clipquest.test/api/workplace/threads/${THREAD_ID}`,
    );
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toEqual({ title: "Renamed" });
  });

  it("deletes a thread via DELETE", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { deleteWorkplaceThread } = await import("../src/workplace/api");

    await deleteWorkplaceThread(THREAD_ID);

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://clipquest.test/api/workplace/threads/${THREAD_ID}`,
    );
    expect(options.method).toBe("DELETE");
  });

  it("fetches a message page and forwards cursor/limit as query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ messages: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchWorkplaceMessages } = await import("../src/workplace/api");

    await fetchWorkplaceMessages(THREAD_ID, "cursor-1", 20);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://clipquest.test/api/workplace/threads/${THREAD_ID}/messages?cursor=cursor-1&limit=20`,
    );
  });

  it("omits query params entirely when no cursor/limit is given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ messages: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchWorkplaceMessages } = await import("../src/workplace/api");

    await fetchWorkplaceMessages(THREAD_ID);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://clipquest.test/api/workplace/threads/${THREAD_ID}/messages`,
    );
  });

  it("syncs a message via POST and returns the persisted record", async () => {
    const message = {
      id: MESSAGE_ID,
      threadId: THREAD_ID,
      clientMessageId: "client-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hi" }],
      createdAt: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message }));
    vi.stubGlobal("fetch", fetchMock);
    const { syncWorkplaceMessage } = await import("../src/workplace/api");

    const saved = await syncWorkplaceMessage({
      threadId: THREAD_ID,
      clientMessageId: "client-1",
      role: "user",
      parts: [{ type: "text", text: "Hi" }],
    });

    expect(saved).toEqual(message);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://clipquest.test/api/workplace/threads/${THREAD_ID}/messages`,
    );
    expect(options.method).toBe("POST");
  });

  it("fetches suggestions from GET /api/workplace/suggestions", async () => {
    const suggestions = [
      {
        kind: "recent",
        videoId: "33333333-3333-4333-8333-333333333333",
        quizId: null,
        title: "Pick up derivatives",
        reason: "You watched this recently.",
      },
      {
        kind: "unmastered",
        videoId: "44444444-4444-4444-8444-444444444444",
        quizId: null,
        title: "Review integrals",
        reason: "Needs more practice.",
      },
      {
        kind: "due",
        videoId: "55555555-5555-4555-8555-555555555555",
        quizId: null,
        title: "Limits refresher",
        reason: "Due for review.",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ suggestions }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchWorkplaceSuggestions } = await import("../src/workplace/api");

    const result = await fetchWorkplaceSuggestions();

    expect(result).toEqual(suggestions);
  });

  it("generates unique client message ids", async () => {
    const { newWorkplaceClientMessageId } =
      await import("../src/workplace/api");
    const a = newWorkplaceClientMessageId();
    const b = newWorkplaceClientMessageId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
