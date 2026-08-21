const { withAppBuildGradle } = require("expo/config-plugins");

const DEBUG_RELEASE_SIGNING = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
const RELEASE_SIGNING_GUARD = `            // ClipQuest release signing is injected by EAS Build. Keep local
            // assembleRelease output unsigned instead of using debug.keystore.`;

function removeDebugReleaseSigning(contents) {
  if (contents.includes(RELEASE_SIGNING_GUARD)) return contents;
  if (!contents.includes(DEBUG_RELEASE_SIGNING)) {
    throw new Error(
      "Could not locate the generated Android debug release-signing block.",
    );
  }
  return contents.replace(DEBUG_RELEASE_SIGNING, RELEASE_SIGNING_GUARD);
}

function withAndroidReleaseSigningGuard(config) {
  return withAppBuildGradle(config, (next) => {
    if (next.modResults.language !== "groovy") {
      throw new Error(
        "ClipQuest Android release signing requires Groovy Gradle.",
      );
    }
    next.modResults.contents = removeDebugReleaseSigning(
      next.modResults.contents,
    );
    return next;
  });
}

module.exports = withAndroidReleaseSigningGuard;
module.exports.removeDebugReleaseSigning = removeDebugReleaseSigning;
