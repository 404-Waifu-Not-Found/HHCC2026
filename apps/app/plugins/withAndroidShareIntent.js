const {
  withAndroidManifest,
  withMainActivity,
} = require("expo/config-plugins");

function injectShareIntentHandler(contents) {
  if (contents.includes("private fun normalizedShareIntent")) return contents;
  let source = contents.replace(
    "import android.os.Bundle",
    [
      "import android.os.Bundle",
      "import android.content.Intent",
      "import android.net.Uri",
    ].join("\n"),
  );
  source = source.replace(
    "    super.onCreate(null)",
    "    intent = normalizedShareIntent(intent)\n    super.onCreate(null)",
  );
  const shareHandler = `
  override fun onNewIntent(nextIntent: Intent) {
    val normalized = normalizedShareIntent(nextIntent)
    intent = normalized
    super.onNewIntent(normalized)
  }

  private fun normalizedShareIntent(source: Intent): Intent {
    if (source.action != Intent.ACTION_SEND || source.type != "text/plain") {
      return source
    }
    val text = source.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
    val url = Regex("https?://[^\\\\s]+", RegexOption.IGNORE_CASE)
      .findAll(text)
      .map { it.value.trimEnd('.', ',', ')', ']', '}', ';') }
      .firstOrNull { candidate ->
        val host = runCatching { Uri.parse(candidate).host?.lowercase() }.getOrNull()
        host == "youtube.com" || host == "www.youtube.com" ||
          host == "m.youtube.com" || host == "youtu.be"
      }
      ?: return source
    return Intent(Intent.ACTION_VIEW, Uri.parse("clipquest://share?url=\${Uri.encode(url)}"))
      .setPackage(packageName)
  }

`;
  return source.replace(
    "  override fun getMainComponentName()",
    `${shareHandler}  override fun getMainComponentName()`,
  );
}

function withAndroidShareIntent(config) {
  const withManifest = withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0];
    const activity = application?.activity?.find(
      (candidate) => candidate.$?.["android:name"] === ".MainActivity",
    );
    if (!activity) return next;
    activity["intent-filter"] ??= [];
    const hasShare = activity["intent-filter"].some((filter) =>
      filter.action?.some(
        (action) => action.$?.["android:name"] === "android.intent.action.SEND",
      ),
    );
    if (!hasShare) {
      activity["intent-filter"].push({
        action: [{ $: { "android:name": "android.intent.action.SEND" } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
        ],
        data: [{ $: { "android:mimeType": "text/plain" } }],
      });
    }
    return next;
  });

  return withMainActivity(withManifest, (next) => {
    if (next.modResults.language !== "kt") {
      throw new Error(
        "ClipQuest Android sharing requires a Kotlin MainActivity.",
      );
    }
    next.modResults.contents = injectShareIntentHandler(
      next.modResults.contents,
    );
    return next;
  });
}

module.exports = withAndroidShareIntent;
module.exports.injectShareIntentHandler = injectShareIntentHandler;
