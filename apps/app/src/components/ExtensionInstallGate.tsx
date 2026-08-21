import { VoxelIcon } from "./VoxelIcon";
import { usePathname } from "expo-router";
import {
  useCallback,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { Modal, Platform, StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  detectClipQuestExtension,
  isCompatibleClipQuestExtensionVersion,
  subscribeToClipQuestExtension,
  supportsQuestionStream,
} from "../transcription/clipquest-extension";
import {
  borders,
  layout,
  radii,
  shadows,
  spacing,
  typography,
} from "../theme/tokens";
import { BrandLockup } from "./BrandLockup";
import { PrimaryButton } from "./PrimaryButton";
import { FeedbackMotion, MotionView, StaggerItem } from "../motion/Motion";
import { routeRequiresClipQuestExtension } from "../transcription/extension-route";

type GateStatus = "checking" | "missing" | "outdated" | "available";

export function ExtensionInstallGate({ children }: PropsWithChildren) {
  const { reduceMotion, t, theme } = useSettings();
  const pathname = usePathname();
  const [status, setStatus] = useState<GateStatus>(
    Platform.OS === "web" ? "checking" : "available",
  );
  const [downloaded, setDownloaded] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (Platform.OS !== "web") return;
    setChecking(true);
    const result = await detectClipQuestExtension();
    setStatus(
      !result.available
        ? "missing"
        : isCompatibleClipQuestExtensionVersion(result.version) &&
            supportsQuestionStream(result.capabilities)
          ? "available"
          : "outdated",
    );
    setChecking(false);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeToClipQuestExtension(
      ({ version, capabilities }) =>
        setStatus(
          isCompatibleClipQuestExtensionVersion(version) &&
            supportsQuestionStream(capabilities)
            ? "available"
            : "outdated",
        ),
    );
    const initialCheck = setTimeout(() => void check(), 0);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(initialCheck);
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  const download = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const link = document.createElement("a");
    link.href = "/clipquest-captions-extension.zip";
    link.download = "clipquest-captions-extension.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setDownloaded(true);
  };

  return (
    <>
      {children}
      <Modal
        visible={
          (status === "missing" || status === "outdated") &&
          routeRequiresClipQuestExtension(pathname)
        }
        transparent
        animationType={reduceMotion ? "none" : "fade"}
        onRequestClose={() => undefined}
        statusBarTranslucent
      >
        <View
          accessibilityViewIsModal
          style={[styles.overlay, { backgroundColor: theme.overlay }]}
        >
          <MotionView
            preset="pop"
            style={[
              styles.card,
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.borderStrong,
                boxShadow:
                  theme.mode === "dark"
                    ? shadows.darkFloating
                    : shadows.floating,
              },
            ]}
          >
            <BrandLockup descriptor="Local AI" size="compact" />
            <MotionView preset="rise" delay={44} style={styles.headingRow}>
              <MotionView
                preset="pop"
                style={[styles.icon, { backgroundColor: theme.primarySoft }]}
              >
                <VoxelIcon name="captions" size={30} color={theme.primary} />
              </MotionView>
              <View style={styles.headingCopy}>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: theme.text }]}
                >
                  {t(
                    status === "outdated"
                      ? "extensionUpdateTitle"
                      : "extensionRequiredTitle",
                  )}
                </Text>
                <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                  {t(
                    status === "outdated"
                      ? "extensionUpdateBody"
                      : "extensionRequiredBody",
                  )}
                </Text>
              </View>
            </MotionView>

            <View style={styles.steps}>
              <StaggerItem index={0}>
                <InstallStep number="1" text={t("extensionStepDownload")} />
              </StaggerItem>
              <StaggerItem index={1}>
                <InstallStep number="2" text={t("extensionStepOpen")} />
              </StaggerItem>
              <StaggerItem index={2}>
                <InstallStep number="3" text={t("extensionStepLoad")} />
              </StaggerItem>
            </View>

            <MotionView
              preset="rise"
              delay={132}
              style={[
                styles.privacy,
                {
                  backgroundColor: theme.successSoft,
                  borderColor: theme.success,
                },
              ]}
            >
              <VoxelIcon
                name="privacy"
                size={21}
                color={theme.successPressed}
              />
              <Text style={[styles.privacyText, { color: theme.text }]}>
                {t("extensionPrivacy")}
              </Text>
            </MotionView>

            <View style={styles.actions}>
              <PrimaryButton
                testID="download-caption-extension"
                leadingIcon={
                  <VoxelIcon
                    name="download"
                    size={20}
                    color={theme.textOnAction}
                  />
                }
                onPress={download}
              >
                {downloaded
                  ? t("extensionDownloadAgain")
                  : t("extensionDownload")}
              </PrimaryButton>
              <PrimaryButton
                testID="check-caption-extension"
                variant="ghost"
                loading={checking}
                leadingIcon={
                  <VoxelIcon name="refresh" size={20} color={theme.text} />
                }
                onPress={() => void check()}
              >
                {t("extensionCheck")}
              </PrimaryButton>
            </View>
            {downloaded ? (
              <FeedbackMotion signal={downloaded} kind="success">
                <MotionView preset="rise" exiting>
                  <Text
                    accessibilityRole="alert"
                    style={[styles.downloaded, { color: theme.primary }]}
                  >
                    {t("extensionDownloaded")}
                  </Text>
                </MotionView>
              </FeedbackMotion>
            ) : null}
          </MotionView>
        </View>
      </Modal>
    </>
  );
}

function InstallStep({ number, text }: { number: string; text: string }) {
  const { theme } = useSettings();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, { backgroundColor: theme.primary }]}>
        <Text style={[styles.stepNumberText, { color: theme.textOnPrimary }]}>
          {number}
        </Text>
      </View>
      <Text style={[styles.stepText, { color: theme.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[5],
  },
  card: {
    width: "100%",
    maxWidth: Math.min(layout.reading, 620),
    borderWidth: borders.standard,
    borderRadius: radii.modal,
    padding: spacing[6],
    gap: spacing[5],
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[4],
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radii.large,
    alignItems: "center",
    justifyContent: "center",
  },
  headingCopy: { minWidth: 0, flex: 1, gap: spacing[2] },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  subtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  steps: { gap: spacing[3] },
  step: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  stepNumber: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  stepText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  privacy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderWidth: borders.hairline,
    borderRadius: radii.medium,
    padding: spacing[4],
  },
  privacyText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  actions: { gap: spacing[3] },
  downloaded: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
    textAlign: "center",
  },
});
