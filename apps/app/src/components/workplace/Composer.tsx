// Sticky bottom composer for a Workplace thread: personalized suggestion
// pills (one primary "recent" pill plus two secondary "unmastered"/"due"
// pills) above a text input and send button. Suggestions prefill the
// composer rather than auto-sending, so the learner can edit the prompt
// before it goes out.
import { StyleSheet, Text, View } from "react-native";
import type { WorkplaceSuggestion } from "@clipquest/contracts";
import { useSettings } from "../../providers/SettingsProvider";
import {
  borders,
  controls,
  radii,
  spacing,
  typography,
} from "../../theme/tokens";
import { MotionPressable, StaggerItem } from "../../motion/Motion";
import { AppTextInput } from "../AppTextInput";
import { IconButton } from "../IconButton";
import type { MessageKey } from "../../i18n/messages";

const SUGGESTION_LABEL_KEYS: Record<WorkplaceSuggestion["kind"], MessageKey> = {
  recent: "workplaceSuggestionRecent",
  unmastered: "workplaceSuggestionUnmastered",
  due: "workplaceSuggestionDue",
};

function SuggestionPill({
  suggestion,
  primary,
  onPress,
}: {
  suggestion: WorkplaceSuggestion;
  primary: boolean;
  onPress(): void;
}) {
  const { t, theme } = useSettings();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={`${t(SUGGESTION_LABEL_KEYS[suggestion.kind])}: ${suggestion.title}`}
      accessibilityHint={suggestion.reason}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.pill,
        primary && styles.pillPrimary,
        {
          backgroundColor: primary
            ? theme.primarySoft
            : hovered
              ? theme.surfaceTint
              : theme.surface,
          borderColor: primary ? theme.primary : theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Text
        style={[styles.pillKind, { color: theme.primary }]}
        numberOfLines={1}
      >
        {t(SUGGESTION_LABEL_KEYS[suggestion.kind])}
      </Text>
      <Text
        style={[styles.pillTitle, { color: theme.text }]}
        numberOfLines={primary ? 2 : 1}
      >
        {suggestion.title}
      </Text>
    </MotionPressable>
  );
}

export function SuggestionPills({
  suggestions,
  onPress,
}: {
  suggestions: WorkplaceSuggestion[];
  onPress(suggestion: WorkplaceSuggestion): void;
}) {
  const { t, theme } = useSettings();
  if (!suggestions.length) return null;
  const primary = suggestions.find((item) => item.kind === "recent");
  const secondary = suggestions.filter((item) => item.kind !== "recent");

  return (
    <View style={styles.suggestions}>
      <Text style={[styles.suggestionsTitle, { color: theme.textMuted }]}>
        {t("workplaceSuggestionsTitle")}
      </Text>
      <View style={styles.suggestionRows}>
        {primary ? (
          <StaggerItem index={0} style={styles.primaryRow}>
            <SuggestionPill
              suggestion={primary}
              primary
              onPress={() => onPress(primary)}
            />
          </StaggerItem>
        ) : null}
        <View style={styles.secondaryRow}>
          {secondary.map((suggestion, index) => (
            <StaggerItem
              key={suggestion.videoId + suggestion.kind}
              index={index + 1}
              style={styles.secondaryItem}
            >
              <SuggestionPill
                suggestion={suggestion}
                primary={false}
                onPress={() => onPress(suggestion)}
              />
            </StaggerItem>
          ))}
        </View>
      </View>
    </View>
  );
}

export function Composer({
  value,
  onChangeText,
  onSend,
  sending,
  disabled,
  placeholder,
}: {
  value: string;
  onChangeText(value: string): void;
  onSend(): void;
  sending: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useSettings();
  const canSend = value.trim().length > 0 && !sending && !disabled;

  return (
    <View style={styles.composer}>
      <View style={styles.field}>
        <AppTextInput
          label={t("workplaceComposerPlaceholder")}
          labelPlacement="inside"
          accessibilityLabel={t("workplaceComposerPlaceholder")}
          placeholder={placeholder ?? t("workplaceComposerPlaceholder")}
          value={value}
          editable={!disabled}
          multiline
          maxLength={4_000}
          onChangeText={onChangeText}
          onSubmitEditing={() => {
            if (canSend) onSend();
          }}
          style={styles.input}
        />
      </View>
      <IconButton
        icon="send"
        label={t("workplaceSend")}
        tone="primary"
        disabled={!canSend}
        onPress={onSend}
        size={22}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: {
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  suggestionsTitle: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.caption,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  suggestionRows: {
    gap: spacing[2],
  },
  primaryRow: {
    width: "100%",
  },
  secondaryRow: {
    flexDirection: "row",
    gap: spacing[2],
  },
  secondaryItem: {
    flex: 1,
  },
  pill: {
    borderWidth: borders.standard,
    borderRadius: radii.large,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: 2,
  },
  pillPrimary: {
    borderRadius: radii.large,
  },
  pillKind: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  pillTitle: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  field: {
    flex: 1,
  },
  input: {
    maxHeight: 140,
    minHeight: controls.inputHeight - borders.standard * 2,
  },
});
