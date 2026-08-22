import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("library delete quest", () => {
  it("deduplicates refresh requests and uses soft refresh after first load", async () => {
    const source = await readFile(
      resolve(appRoot, "app/(tabs)/library.tsx"),
      "utf8",
    );

    expect(source).toContain("const [refreshing, setRefreshing] = useState(false);");
    expect(source).toContain("const refreshRequestRef = useRef<Promise<void> | null>(null);");
    expect(source).toContain("if (refreshRequestRef.current) return refreshRequestRef.current;");
    expect(source).toContain("const firstLoad = !hasLoadedLibraryRef.current;");
    expect(source).toContain("if (firstLoad) setLoading(true);");
    expect(source).toContain("else setRefreshing(true);");
    expect(source).toContain("if (requestId !== refreshRequestIdRef.current) return;");
    expect(source).toContain("{refreshing && !loading ? (");
  });

  it("does not block deletion on session state before calling the API", async () => {
    const source = await readFile(
      resolve(appRoot, "app/(tabs)/library.tsx"),
      "utf8",
    );

    expect(source).not.toContain(
      "if (!session?.user.id || deletingId) return;",
    );
    expect(source).toContain("if (deletingId) return;");
    expect(source).toContain(
      "await apiRequest(\n          `/api/videos/${encodeURIComponent(card.videoId)}`",
    );
    expect(source).toContain("if (session?.user.id) {");
    expect(source).toContain(
      "await clearImportedVideo(session.user.id, card.videoId);",
    );
  });

  it("uses an explicit web confirm fallback before destructive delete", async () => {
    const source = await readFile(
      resolve(appRoot, "app/(tabs)/library.tsx"),
      "utf8",
    );

    expect(source).toContain('Platform.OS === "web"');
    expect(source).toContain('typeof window !== "undefined"');
    expect(source).toContain("window.confirm(");
    expect(source).toContain("if (confirmed) void deleteQuest(card);");
    expect(source).toContain('Alert.alert(t("deleteQuest")');
  });
});
