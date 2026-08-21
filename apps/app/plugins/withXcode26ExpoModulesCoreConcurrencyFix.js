const { withDangerousMod } = require("expo/config-plugins");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const MARKER =
  "# ClipQuest Xcode 26.2 ExpoModulesCore concurrency compatibility";

function patchPodfile(contents) {
  if (contents.includes(MARKER)) return contents;

  const postInstallPattern =
    /(\s+react_native_post_install\([\s\S]*?\n\s+\)\n)/;
  const match = contents.match(postInstallPattern);
  if (!match) {
    throw new Error(
      "Could not locate react_native_post_install in the generated iOS Podfile.",
    );
  }

  const compatibilitySettings = `${match[1]}
    ${MARKER}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'ExpoModulesCore'

      target.build_configurations.each do |build_config|
        build_config.build_settings['SWIFT_VERSION'] = '5.10'
        build_config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        build_config.build_settings['SWIFT_COMPILATION_MODE'] = 'singlefile'
      end
    end
`;

  return contents.replace(postInstallPattern, compatibilitySettings);
}

function withXcode26ExpoModulesCoreConcurrencyFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (next) => {
      const podfilePath = path.join(
        next.modRequest.platformProjectRoot,
        "Podfile",
      );
      const contents = await readFile(podfilePath, "utf8");
      await writeFile(podfilePath, patchPodfile(contents));
      return next;
    },
  ]);
}

module.exports = withXcode26ExpoModulesCoreConcurrencyFix;
module.exports.patchPodfile = patchPodfile;
