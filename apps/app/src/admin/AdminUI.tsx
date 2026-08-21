import { VoxelIcon } from "../components/VoxelIcon";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { AppTextInput } from "../components/AppTextInput";
import { EmptyState } from "../components/EmptyState";
import { PrimaryButton, type ButtonVariant } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { Surface } from "../components/Surface";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  breakpoints,
  motion,
  radii,
  spacing,
  typography,
} from "../theme/tokens";
import { useAdminCopy } from "./copy";
import {
  FeedbackMotion,
  MotionPressable,
  MotionSkeleton,
  MotionView,
} from "../motion/Motion";

export function AdminPage({
  title,
  subtitle,
  icon,
  children,
  action,
}: PropsWithChildren<{
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof VoxelIcon>["name"];
  action?: ReactNode;
}>) {
  const { theme } = useSettings();
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  return (
    <Screen contentWidth="wide">
      <MotionView
        preset="rise"
        style={[styles.pageHeader, compact && styles.pageHeaderCompact]}
      >
        <View style={styles.pageHeading}>
          <View
            style={[
              styles.pageIcon,
              {
                backgroundColor: theme.primarySoft,
                borderColor: theme.primary,
              },
            ]}
          >
            <VoxelIcon name={icon} size={27} color={theme.primary} />
          </View>
          <View style={styles.pageHeadingCopy}>
            <Text
              accessibilityRole="header"
              style={[styles.pageTitle, { color: theme.text }]}
            >
              {title}
            </Text>
            <Text style={[styles.pageSubtitle, { color: theme.textMuted }]}>
              {subtitle}
            </Text>
          </View>
        </View>
        {action ? <View style={styles.pageAction}>{action}</View> : null}
      </MotionView>
      {children}
    </Screen>
  );
}

export function AdminSection({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) {
  const { theme } = useSettings();
  return (
    <MotionView preset="rise" layout style={styles.section}>
      <MotionView preset="from-left" style={styles.sectionHeading}>
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: theme.text }]}
        >
          {title}
        </Text>
        {description ? (
          <Text style={[styles.sectionDescription, { color: theme.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </MotionView>
      {children}
    </MotionView>
  );
}

export function AdminToolbar({
  search,
  onSearchChange,
  onSubmit,
  children,
}: PropsWithChildren<{
  search: string;
  onSearchChange(value: string): void;
  onSubmit(): void;
}>) {
  const copy = useAdminCopy();
  const { theme } = useSettings();
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  return (
    <Surface
      style={compact ? [styles.toolbar, styles.toolbarCompact] : styles.toolbar}
    >
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <AppTextInput
            label={copy.search}
            placeholder={copy.searchPlaceholder}
            value={search}
            onChangeText={onSearchChange}
            onSubmitEditing={onSubmit}
            returnKeyType="search"
            leading={
              <VoxelIcon name="search" size={23} color={theme.textMuted} />
            }
          />
        </View>
        <View
          style={[styles.searchAction, compact && styles.searchActionCompact]}
        >
          <PrimaryButton compact variant="secondary" onPress={onSubmit}>
            {copy.search}
          </PrimaryButton>
        </View>
      </View>
      {children ? <View style={styles.filters}>{children}</View> : null}
    </Surface>
  );
}

export function FilterChips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
  label: string;
}) {
  const { theme, reduceMotion } = useSettings();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      contentContainerStyle={styles.chips}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <MotionPressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed, hovered }) => [
              styles.chip,
              {
                backgroundColor: selected
                  ? theme.primarySoft
                  : hovered
                    ? theme.surfaceSunken
                    : theme.surface,
                borderColor: selected ? theme.primary : theme.borderStrong,
                transform: [{ translateY: pressed && !reduceMotion ? 2 : 0 }],
              },
              Platform.OS === "web" && {
                transitionDuration: `${motion.fast}ms`,
                transitionProperty: "transform, background-color, border-color",
              },
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                { color: selected ? theme.primary : theme.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </MotionPressable>
        );
      })}
    </ScrollView>
  );
}

export function AdminRecord({
  children,
  tone,
}: PropsWithChildren<{ tone?: "default" | "error" | "warning" }>) {
  return (
    <MotionView preset="rise" layout>
      <Surface tone={tone} style={styles.record}>
        {children}
      </Surface>
    </MotionView>
  );
}

export function RecordHeading({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  const { theme } = useSettings();
  return (
    <View style={styles.recordHeading}>
      <View style={styles.recordTitleBlock}>
        <View style={styles.recordTitleRow}>
          <Text selectable style={[styles.recordTitle, { color: theme.text }]}>
            {title}
          </Text>
          {badge}
        </View>
        {subtitle ? (
          <Text
            selectable
            style={[styles.recordSubtitle, { color: theme.textMuted }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.recordActions}>{actions}</View> : null}
    </View>
  );
}

export function RecordMeta({
  items,
}: {
  items: {
    label: string;
    value: string;
    icon?: ComponentProps<typeof VoxelIcon>["name"];
  }[];
}) {
  const { theme } = useSettings();
  return (
    <View style={styles.metaGrid}>
      {items.map((item) => (
        <View key={`${item.label}-${item.value}`} style={styles.metaItem}>
          {item.icon ? (
            <VoxelIcon name={item.icon} size={17} color={theme.textSubtle} />
          ) : null}
          <Text style={[styles.metaLabel, { color: theme.textSubtle }]}>
            {item.label}
          </Text>
          <Text
            selectable
            numberOfLines={2}
            style={[styles.metaValue, { color: theme.text }]}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "primary" | "success" | "warning" | "error";
}) {
  const { theme } = useSettings();
  const colors =
    tone === "success"
      ? {
          background: theme.successSoft,
          border: theme.success,
          text: theme.successPressed,
        }
      : tone === "warning"
        ? {
            background: theme.warningSoft,
            border: theme.warning,
            text: theme.warningText,
          }
        : tone === "error"
          ? {
              background: theme.errorSoft,
              border: theme.error,
              text: theme.errorPressed,
            }
          : tone === "primary"
            ? {
                background: theme.primarySoft,
                border: theme.primary,
                text: theme.primary,
              }
            : {
                background: theme.surfaceSunken,
                border: theme.borderStrong,
                text: theme.textMuted,
              };
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.badgeText, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

export function InlineActions({ children }: PropsWithChildren) {
  return <View style={styles.inlineActions}>{children}</View>;
}

export function AdminDataState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: PropsWithChildren<{
  loading: boolean;
  error?: Error;
  empty: boolean;
  onRetry(): void;
}>) {
  const { theme } = useSettings();
  const copy = useAdminCopy();
  if (loading) {
    return (
      <MotionView
        preset="fade"
        style={styles.dataState}
        accessibilityRole="progressbar"
      >
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.dataStateText, { color: theme.textMuted }]}>
          {copy.loading}
        </Text>
        <MotionSkeleton color={theme.primarySoft} style={styles.dataSkeleton} />
        <MotionSkeleton
          color={theme.primarySoft}
          delay={100}
          style={styles.dataSkeletonShort}
        />
      </MotionView>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon="warning"
        title={copy.loadFailed}
        description={error.message}
        action={
          <PrimaryButton variant="secondary" onPress={onRetry}>
            {copy.retry}
          </PrimaryButton>
        }
      />
    );
  }
  if (empty) {
    return (
      <EmptyState
        icon="database"
        title={copy.noResults}
        description={copy.noResultsBody}
      />
    );
  }
  return (
    <MotionView preset="rise" style={styles.records}>
      {children}
    </MotionView>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange(page: number): void;
}) {
  const copy = useAdminCopy();
  const { theme } = useSettings();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <MotionView
      preset="rise"
      style={[styles.pagination, { borderTopColor: theme.divider }]}
    >
      <Text style={[styles.paginationText, { color: theme.textMuted }]}>
        {total} {copy.results} · {page}/{pages}
      </Text>
      <InlineActions>
        <PrimaryButton
          compact
          variant="ghost"
          disabled={page <= 1}
          onPress={() => onChange(page - 1)}
        >
          {copy.previous}
        </PrimaryButton>
        <PrimaryButton
          compact
          variant="ghost"
          disabled={page >= pages}
          onPress={() => onChange(page + 1)}
        >
          {copy.next}
        </PrimaryButton>
      </InlineActions>
    </MotionView>
  );
}

export function ActionDialog({
  visible,
  title,
  description,
  confirmLabel,
  confirmVariant = "secondary",
  reason,
  onReasonChange,
  onClose,
  onConfirm,
  busy = false,
  error,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  reason: string;
  onReasonChange(value: string): void;
  onClose(): void;
  onConfirm(): void;
  busy?: boolean;
  error?: string;
}>) {
  const copy = useAdminCopy();
  const { reduceMotion, theme } = useSettings();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.cancel}
          onPress={busy ? undefined : onClose}
          style={styles.backdropDismiss}
        />
        <MotionView
          preset="pop"
          role="dialog"
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.borderStrong,
            },
          ]}
        >
          <MotionView preset="rise" delay={44} style={styles.dialogHeading}>
            <View
              style={[
                styles.dialogIcon,
                { backgroundColor: theme.primarySoft },
              ]}
            >
              <VoxelIcon name="privacy" size={27} color={theme.primary} />
            </View>
            <View style={styles.dialogCopy}>
              <Text
                accessibilityRole="header"
                style={[styles.dialogTitle, { color: theme.text }]}
              >
                {title}
              </Text>
              <Text
                style={[styles.dialogDescription, { color: theme.textMuted }]}
              >
                {description}
              </Text>
            </View>
          </MotionView>
          {children}
          <AppTextInput
            label={copy.reason}
            placeholder={copy.reasonPlaceholder}
            value={reason}
            onChangeText={onReasonChange}
            multiline
            numberOfLines={3}
            editable={!busy}
            error={error}
          />
          <View style={styles.dialogActions}>
            <View style={styles.dialogAction}>
              <PrimaryButton variant="ghost" disabled={busy} onPress={onClose}>
                {copy.cancel}
              </PrimaryButton>
            </View>
            <View style={styles.dialogAction}>
              <PrimaryButton
                variant={confirmVariant}
                disabled={reason.trim().length < 3}
                loading={busy}
                onPress={onConfirm}
              >
                {confirmLabel}
              </PrimaryButton>
            </View>
          </View>
        </MotionView>
      </View>
    </Modal>
  );
}

export function Notice({
  tone,
  text,
}: {
  tone: "success" | "error";
  text: string;
}) {
  const { theme } = useSettings();
  const color = tone === "success" ? theme.success : theme.error;
  return (
    <FeedbackMotion signal={text} kind={tone === "error" ? "error" : "success"}>
      <MotionView preset="rise" exiting>
        <Surface tone={tone} style={styles.notice}>
          <View
            accessibilityRole={tone === "error" ? "alert" : undefined}
            style={styles.noticeRow}
          >
            <VoxelIcon
              name={tone === "success" ? "correct" : "error"}
              size={22}
              color={color}
            />
            <Text style={[styles.noticeText, { color: theme.text }]}>
              {text}
            </Text>
          </View>
        </Surface>
      </MotionView>
    </FeedbackMotion>
  );
}

export function AdminTwoColumn({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  return (
    <View
      style={[
        styles.twoColumn,
        width >= breakpoints.tablet && styles.twoColumnWide,
      ]}
    >
      {children}
    </View>
  );
}

export function AdminColumn({ children }: PropsWithChildren) {
  return <View style={styles.column}>{children}</View>;
}

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[4],
    marginBottom: spacing[8],
    flexWrap: "wrap",
  },
  pageHeaderCompact: {
    marginBottom: spacing[6],
  },
  pageHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    minWidth: 0,
    flex: 1,
  },
  pageIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.large,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  pageHeadingCopy: { minWidth: 0, flex: 1, gap: spacing[1] },
  pageTitle: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  pageSubtitle: {
    maxWidth: 680,
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  pageAction: { minWidth: 180 },
  section: { gap: spacing[4], marginBottom: spacing[8] },
  sectionHeading: { gap: spacing[1] },
  sectionTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  sectionDescription: {
    maxWidth: 720,
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  toolbar: { marginBottom: spacing[5], gap: spacing[4] },
  toolbarCompact: { padding: spacing[5] },
  searchRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  searchField: { flex: 1, minWidth: 240 },
  searchAction: { minWidth: 116 },
  searchActionCompact: { width: "100%" },
  filters: {
    borderTopWidth: borders.hairline,
    borderTopColor: "transparent",
    paddingTop: spacing[1],
  },
  chips: {
    gap: spacing[2],
    paddingVertical: spacing[1],
    paddingRight: spacing[4],
  },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderWidth: borders.standard,
    borderBottomWidth: borders.tactileDepth,
    borderRadius: radii.medium,
  },
  chipLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  records: { gap: spacing[3] },
  record: { gap: spacing[4] },
  recordHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[4],
    flexWrap: "wrap",
  },
  recordTitleBlock: { minWidth: 0, flex: 1, gap: spacing[1] },
  recordTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  recordTitle: {
    flexShrink: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
  },
  recordSubtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  recordActions: { maxWidth: "100%" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  metaItem: {
    minWidth: 150,
    flexGrow: 1,
    flexBasis: 180,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  metaLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: {
    flexShrink: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  badge: {
    minHeight: 28,
    justifyContent: "center",
    borderWidth: borders.hairline,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
  },
  badgeText: { fontFamily: typography.bodyBold, fontSize: 12, lineHeight: 16 },
  inlineActions: { flexDirection: "row", gap: spacing[2], flexWrap: "wrap" },
  dataState: {
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
  },
  dataStateText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
  },
  dataSkeleton: {
    width: "72%",
    maxWidth: 420,
    height: 10,
    borderRadius: radii.pill,
  },
  dataSkeletonShort: {
    width: "46%",
    maxWidth: 280,
    height: 10,
    borderRadius: radii.pill,
  },
  pagination: {
    marginTop: spacing[4],
    paddingTop: spacing[4],
    borderTopWidth: borders.hairline,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  paginationText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[4],
  },
  backdropDismiss: {
    position: "absolute",
    inset: 0,
  },
  dialog: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    borderWidth: borders.standard,
    borderRadius: radii.modal,
    padding: spacing[6],
    gap: spacing[5],
  },
  dialogHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[4],
  },
  dialogIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.large,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogCopy: { minWidth: 0, flex: 1, gap: spacing[1] },
  dialogTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  dialogDescription: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  dialogActions: { flexDirection: "row", gap: spacing[3] },
  dialogAction: { flex: 1 },
  notice: { marginBottom: spacing[5] },
  noticeRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  noticeText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  twoColumn: { gap: spacing[4] },
  twoColumnWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0, gap: spacing[4] },
});
