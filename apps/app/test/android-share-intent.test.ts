import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { injectShareIntentHandler } =
  require("../plugins/withAndroidShareIntent.js") as {
    injectShareIntentHandler(contents: string): string;
  };

const MAIN_ACTIVITY = `package cc.ccwu.clipquest

import android.os.Bundle

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

describe("Android YouTube share intent", () => {
  it("injects cold- and warm-start handling exactly once", () => {
    const injected = injectShareIntentHandler(MAIN_ACTIVITY);
    expect(injected).toContain("import android.content.Intent");
    expect(injected).toContain("intent = normalizedShareIntent(intent)");
    expect(injected).toContain("override fun onNewIntent");
    expect(injected).toContain('source.type != "text/plain"');
    expect(injected).toContain('host == "youtu.be"');
    expect(injectShareIntentHandler(injected)).toBe(injected);
  });
});
