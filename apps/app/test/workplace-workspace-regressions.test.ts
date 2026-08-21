import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "../src/i18n/messages";

const appRoot = resolve(import.meta.dirname, "..");

function source(path: string) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

const workplaceScreen = source("app/(tabs)/workplace.tsx");
const threadRail = source("src/components/workplace/ThreadRail.tsx");
const composer = source("src/components/workplace/Composer.tsx");
const toolCallTrail = source("src/components/workplace/ToolCallTrail.tsx");
const citationChip = source("src/components/workplace/CitationChip.tsx");
const assistantDocument = source(
  "src/components/workplace/AssistantDocument.tsx",
);
const practiceSet = source("src/components/WorkplacePracticeSet.tsx");

describe("Workplace responsive layout", () => {
  it("derives the layout mode from window width via workplaceLayoutForWidth", () => {
    expect(workplaceScreen).toContain(
      "const layoutMode = workplaceLayoutForWidth(width);",
    );
    expect(workplaceScreen).toContain(
      'const isMobile = layoutMode === "mobile";',
    );
  });

  it("shows the rail and detail panes side by side except on mobile", () => {
    expect(workplaceScreen).toContain(
      'const showRail = !isMobile || mobilePane === "rail";',
    );
    expect(workplaceScreen).toContain(
      'const showDetail = !isMobile || mobilePane === "detail";',
    );
    expect(workplaceScreen).toContain(
      "styles.body, isMobile && styles.bodyMobile",
    );
  });

  it("gives the mobile detail pane a back button instead of a persistent rail", () => {
    expect(workplaceScreen).toContain(
      '{isMobile ? (\n          <IconButton icon="back" label={t("back")} onPress={onBack} />\n        ) : null}',
    );
    expect(workplaceScreen).toContain('onBack={() => setMobilePane("rail")}');
  });

  it("only ever displays one mobile pane per state, and both on desktop/tablet", () => {
    // On mobile exactly one of rail/detail is visible; on desktop/tablet both are.
    expect(workplaceScreen).toMatch(/showRail \? \(/);
    expect(workplaceScreen).toMatch(/showDetail \? \(/);
  });
});

describe("Workplace thread rail", () => {
  it("supports create, rename, and delete actions with confirmation", () => {
    expect(threadRail).toContain("onCreate(): void;");
    expect(threadRail).toContain(
      "onRename(threadId: string, title: string): void;",
    );
    expect(threadRail).toContain("onDelete(threadId: string): void;");
    expect(threadRail).toContain('Alert.alert(t("workplaceDeleteThread")');
  });

  it("shows unread counts, last-message previews, and relative timestamps", () => {
    expect(threadRail).toContain("unreadByThreadId");
    expect(threadRail).toContain("previewByThreadId");
    expect(threadRail).toContain("formatWorkplaceTimestamp(");
    expect(threadRail).toContain('unread > 9 ? "9+" : unread');
  });

  it("renders a scrollable, accessible thread list with a loading skeleton", () => {
    expect(threadRail).toContain("<FlatList");
    expect(threadRail).toContain('accessibilityRole="list"');
    expect(threadRail).toContain("<MotionSkeleton");
  });

  it("shows an empty state when there are no threads yet", () => {
    expect(threadRail).toContain('icon="workplace"');
    expect(threadRail).toContain('title={t("workplaceEmptyThreadListTitle")}');
  });
});

describe("Workplace composer and suggestions", () => {
  it("renders a text input and send button that disable while sending/offline", () => {
    expect(composer).toContain(
      "const canSend = value.trim().length > 0 && !sending && !disabled;",
    );
    expect(composer).toContain('icon="send"');
    expect(composer).toContain("disabled={!canSend}");
  });

  it("supports submitting via the keyboard's send action", () => {
    expect(composer).toContain(
      "onSubmitEditing={() => {\n            if (canSend) onSend();\n          }}",
    );
  });

  it("shows a primary suggestion pill plus two secondary pills", () => {
    expect(composer).toContain(
      'suggestions.find((item) => item.kind === "recent")',
    );
    expect(composer).toContain(
      'suggestions.filter((item) => item.kind !== "recent")',
    );
    expect(composer).toContain(
      "<SuggestionPill\n              suggestion={primary}\n              primary",
    );
  });

  it("maps each suggestion kind to a distinct learner-facing label", () => {
    expect(composer).toContain('recent: "workplaceSuggestionRecent"');
    expect(composer).toContain('unmastered: "workplaceSuggestionUnmastered"');
    expect(composer).toContain('due: "workplaceSuggestionDue"');
  });
});

describe("Workplace suggestion selection", () => {
  it("prefills the composer and stages the suggested video for the next turn", () => {
    expect(workplaceScreen).toContain("setComposerValue((current) =>");
    expect(workplaceScreen).toContain(
      "current.trim() ? current : suggestion.title",
    );
    expect(workplaceScreen).toContain("setPendingVideoIds((current) =>");
  });
});

describe("Workplace assistant document rendering", () => {
  it("groups consecutive tool entries into a single animated trail", () => {
    expect(assistantDocument).toContain(
      'if (last?.kind === "tools") last.entries.push(entry);',
    );
    expect(assistantDocument).toContain(
      "<ToolCallTrail key={`tools-${index}`}",
    );
  });

  it("shows a streaming cursor only on the final, still-open text block", () => {
    expect(assistantDocument).toContain(
      "streaming && isLast && !group.entry.final",
    );
  });

  it("renders practice sets via the existing interactive WorkplacePracticeSet surface", () => {
    expect(assistantDocument).toContain(
      'import { WorkplacePracticeSet as WorkplacePracticeSetView } from "../WorkplacePracticeSet";',
    );
    expect(assistantDocument).toContain("<WorkplacePracticeSetView");
  });
});

describe("Workplace tool call visualization", () => {
  it("animates the trail with reduced-motion-safe stagger", () => {
    expect(toolCallTrail).toContain("StaggerItem");
  });

  it("shows a spinner while requested/running and a status icon once settled", () => {
    expect(toolCallTrail).toContain(
      'status === "running" || status === "requested"',
    );
    expect(toolCallTrail).toContain(
      '<ActivityIndicator size="small" color={color} />',
    );
    expect(toolCallTrail).toContain(
      'name={status === "error" ? "error" : "correct"}',
    );
  });

  it("renders inline citation chips for grounded tool results", () => {
    expect(toolCallTrail).toContain("<CitationChip");
  });

  it("labels every synced tool with a learner-facing i18n key", () => {
    for (const key of [
      "workplaceToolSearchVideos",
      "workplaceToolSearchTranscript",
      "workplaceToolGeneratePracticeSet",
      "workplaceToolLookupMastery",
      "workplaceToolFindDueReviews",
    ]) {
      expect(toolCallTrail).toContain(key);
    }
  });
});

describe("Workplace citation chips", () => {
  it("are tappable and reveal the grounding quote on expand", () => {
    expect(citationChip).toContain('accessibilityRole="button"');
    expect(citationChip).toContain("setExpanded((current) => !current)");
    expect(citationChip).toContain("accessibilityHint={citation.quote}");
  });
});

describe("Workplace streaming event handling", () => {
  it("folds each streamed event into the live message via applyWorkplaceChatEvent", () => {
    expect(workplaceScreen).toContain(
      "live = applyWorkplaceChatEvent(live, event);",
    );
    expect(workplaceScreen).toContain("setLiveMessage(live);");
  });

  it("persists both the user and assistant turns once the stream settles", () => {
    expect(workplaceScreen).toContain(
      "const savedUser = await syncWorkplaceMessage({",
    );
    expect(workplaceScreen).toContain(
      "savedAssistant = await syncWorkplaceMessage({",
    );
  });

  it("lets the learner stop an in-flight generation", () => {
    expect(workplaceScreen).toContain("abortRef.current?.abort();");
    expect(workplaceScreen).toContain("onStop={stopGeneration}");
  });
});

describe("Workplace error and credential states", () => {
  it("surfaces WorkplaceChatRequestError with sign-in vs credential messaging", () => {
    expect(workplaceScreen).toContain(
      "if (cause instanceof WorkplaceChatRequestError) {",
    );
    expect(workplaceScreen).toContain('t("workplaceSignInRequired")');
    expect(workplaceScreen).toContain('t("workplaceCredentialRequired")');
  });

  it("offers a path to Local AI settings when a DeepSeek key is required", () => {
    expect(workplaceScreen).toContain(
      'setNeedsLocalAi(cause.code === "credential_required")',
    );
    expect(workplaceScreen).toContain('router.push("/local-ai" as never)');
    expect(workplaceScreen).toContain('t("workplaceOpenLocalAi")');
  });

  it("shows a retryable error banner when threads fail to load", () => {
    expect(workplaceScreen).toContain(
      'setThreadsError(t("workplaceLoadFailed"));',
    );
    expect(workplaceScreen).toContain("onPress={() => void loadWorkspace()}");
  });
});

describe("Workplace offline handling", () => {
  it("derives offline state from expo-network's connectivity hook", () => {
    expect(workplaceScreen).toContain(
      "const networkState = Network.useNetworkState();",
    );
    expect(workplaceScreen).toContain(
      "networkState.isConnected === false ||\n    networkState.isInternetReachable === false;",
    );
  });

  it("shows an offline banner and disables the composer while offline", () => {
    expect(workplaceScreen).toContain('t("workplaceOfflineTitle")');
    expect(workplaceScreen).toContain('t("workplaceOfflineBody")');
    expect(workplaceScreen).toContain("disabled={offline}");
  });
});

describe("Workplace loading and empty states", () => {
  it("shows a loading skeleton while messages are fetching", () => {
    expect(workplaceScreen).toContain("messagesLoading && !messages.length");
    expect(workplaceScreen).toContain("<MotionSkeleton");
  });

  it("shows an empty-thread prompt when a thread has no messages yet", () => {
    expect(workplaceScreen).toContain('icon="workplace"');
    expect(workplaceScreen).toContain('title={t("workplaceEmptyThreadTitle")}');
    expect(workplaceScreen).toContain(
      'description={t("workplaceEmptyThreadBody")}',
    );
  });
});

describe("Workplace draft preservation on offline/reconnect", () => {
  it("only clears the composer draft after a message is actually sent", () => {
    const clearingCalls =
      workplaceScreen.match(/setComposerValue\(""\)/g) ?? [];
    // The only call that clears the draft (empty string) must be the one
    // inside sendMessage, right after the optimistic user message is queued.
    // Any other setComposerValue call (initial state, suggestion prefill,
    // the composer's onChange wiring) must pass through a value, never "".
    expect(clearingCalls).toHaveLength(1);
  });

  it("never clears or resets the draft from the offline/network-state effect", () => {
    const offlineDerivation = workplaceScreen.slice(
      workplaceScreen.indexOf("const offline ="),
      workplaceScreen.indexOf("const offline =") + 400,
    );
    expect(offlineDerivation).not.toContain("setComposerValue");
  });

  it("keeps the composer's text bound to draft state instead of clearing it when disabled", () => {
    expect(composer).toContain("editable={!disabled}");
    expect(composer).not.toContain('onChangeText={() => onChangeText("")}');
  });
});

describe("Workplace privacy disclosure", () => {
  it("shows a persistent privacy notice in the thread rail", () => {
    expect(threadRail).toContain('<Surface tone="tinted"');
    expect(threadRail).toContain('<VoxelIcon name="privacy"');
    expect(threadRail).toContain('{t("workplacePrivacyNotice")}');
  });

  it("explains sync, local-only data, and DeepSeek key handling in both locales", () => {
    const en = messages.en.workplacePrivacyNotice.toLowerCase();
    const zh = messages["zh-CN"].workplacePrivacyNotice;
    expect(en).toMatch(/sync/);
    expect(en).toMatch(/device/);
    expect(en).toMatch(/local/);
    expect(en).toMatch(/deepseek/);
    expect(zh.length).toBeGreaterThan(0);
    expect(zh).not.toBe(messages.en.workplacePrivacyNotice);
  });
});

describe("Workplace localization completeness", () => {
  const workplaceKeys = Object.keys(messages.en).filter((key) =>
    key.startsWith("workplace"),
  ) as Array<keyof typeof messages.en>;

  it("has a non-trivial number of Workplace-prefixed translation keys", () => {
    expect(workplaceKeys.length).toBeGreaterThan(20);
  });

  it("provides a non-empty English and Simplified Chinese string for every Workplace key", () => {
    for (const key of workplaceKeys) {
      const en = messages.en[key];
      const zh = messages["zh-CN"][key];
      expect(typeof en).toBe("string");
      expect((en as string).trim().length).toBeGreaterThan(0);
      expect(typeof zh).toBe("string");
      expect((zh as string).trim().length).toBeGreaterThan(0);
    }
  });

  it("translates every Workplace key into Simplified Chinese instead of reusing English", () => {
    for (const key of workplaceKeys) {
      const en = messages.en[key];
      const zh = messages["zh-CN"][key];
      // A handful of short strings (e.g. product/brand nouns) may legitimately
      // be identical, so this only guards against wholesale untranslated
      // copy-paste of the full English sentence for longer strings.
      if (typeof en === "string" && en.length > 12) {
        expect(zh).not.toBe(en);
      }
    }
  });
});

describe("Workplace keyboard and screen-reader accessibility", () => {
  it("exposes the thread list as an accessible, labeled list", () => {
    expect(threadRail).toContain('accessibilityRole="list"');
    expect(threadRail).toMatch(/accessibilityRole="button"/);
    expect(threadRail).toMatch(/accessibilityLabel=/);
  });

  it("exposes the compose area and send button with accessible roles and labels", () => {
    expect(composer).toMatch(/accessibilityLabel=/);
    expect(composer).toMatch(/accessibilityHint=/);
  });

  it("exposes suggestion pills as accessible, labeled buttons", () => {
    expect(composer).toContain('accessibilityRole="button"');
    expect(composer).toMatch(/suggestion/i);
  });

  it("announces the offline banner to assistive technology", () => {
    expect(workplaceScreen).toContain('accessibilityRole="alert"');
  });

  it("marks section headers for screen readers", () => {
    expect(workplaceScreen).toMatch(/accessibilityRole="header"/);
  });

  it("exposes citation chips as expandable, labeled controls", () => {
    expect(citationChip).toContain("accessibilityState={{ expanded");
    expect(citationChip).toMatch(/accessibilityRole="button"/);
  });

  it("exposes practice set controls with accessible roles for keyboard/VoiceOver/TalkBack use", () => {
    expect(practiceSet).toContain('accessibilityRole="summary"');
    expect(practiceSet).toContain('accessibilityRole="alert"');
    expect(practiceSet).toContain('accessibilityLabel={t("shortAnswer")}');
    // Answer options and the submit/save actions delegate to shared,
    // already-accessible primitives rather than raw Pressables.
    expect(practiceSet).toMatch(/<AnswerCard\b/);
    expect(practiceSet).toMatch(/<PrimaryButton\b/);
    const answerCard = source("src/components/AnswerCard.tsx");
    const primaryButton = source("src/components/PrimaryButton.tsx");
    expect(answerCard).toContain('accessibilityRole="button"');
    expect(answerCard).toContain("accessibilityLabel={label}");
    expect(primaryButton).toContain('accessibilityRole="button"');
  });
});
