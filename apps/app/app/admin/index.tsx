import { VoxelIcon } from "../../src/components/VoxelIcon";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AdminDataState,
  AdminPage,
  AdminRecord,
  AdminSection,
  AdminTwoColumn,
  RecordHeading,
  RecordMeta,
  StatusBadge,
} from "../../src/admin/AdminUI";
import { getAdminOverview } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { StatTile } from "../../src/components/StatTile";
import { Surface } from "../../src/components/Surface";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

export default function AdminOverviewScreen() {
  const copy = useAdminCopy();
  const { locale, theme } = useSettings();
  const loader = useCallback(() => getAdminOverview(), []);
  const { data, error, loading, refresh } = useAdminData(loader);

  return (
    <AdminPage
      title={copy.overview}
      subtitle={copy.operationsSubtitle}
      icon="operations"
    >
      <AdminDataState
        loading={loading}
        error={error}
        empty={false}
        onRetry={() => void refresh()}
      >
        {data ? (
          <>
            <View style={styles.stats}>
              <StatTile
                value={data.totals.users.toLocaleString(locale)}
                label={copy.totalUsers}
                icon={
                  <VoxelIcon name="people" size={23} color={theme.primary} />
                }
              />
              <StatTile
                value={data.totals.lessons.toLocaleString(locale)}
                label={copy.totalLessons}
                tone="success"
                icon={
                  <VoxelIcon name="lessons" size={23} color={theme.success} />
                }
              />
              <StatTile
                value={data.totals.activeJobs.toLocaleString(locale)}
                label={copy.activeJobs}
                tone="secondary"
                icon={
                  <VoxelIcon
                    name="processing"
                    size={23}
                    color={theme.secondary}
                  />
                }
              />
              <StatTile
                value={data.totals.failedJobs.toLocaleString(locale)}
                label={copy.failedJobs}
                tone="warning"
                icon={
                  <VoxelIcon name="error" size={23} color={theme.warning} />
                }
              />
            </View>
            <AdminSection
              title={copy.learningQualityKpis}
              description={copy.learningQualityKpisBody}
            >
              <View style={styles.stats}>
                <StatTile
                  value={percentValue(data.learningMetrics.questionQualityRate)}
                  label={copy.questionQualityRate}
                  tone="success"
                  icon={<VoxelIcon name="correct" size={23} color={theme.success} />}
                />
                <StatTile
                  value={percentValue(data.learningMetrics.retryRate)}
                  label={copy.retryRate}
                  tone="warning"
                  icon={<VoxelIcon name="refresh" size={23} color={theme.warning} />}
                />
                <StatTile
                  value={percentValue(data.learningMetrics.completionRate)}
                  label={copy.completionRate}
                  tone="primary"
                  icon={<VoxelIcon name="target" size={23} color={theme.primary} />}
                />
                <StatTile
                  value={percentValue(data.learningMetrics.correctionRate)}
                  label={copy.correctionRate}
                  tone="secondary"
                  icon={
                    <VoxelIcon name="progress" size={23} color={theme.secondary} />
                  }
                />
              </View>
            </AdminSection>

            <AdminTwoColumn>
              <View style={styles.columnWide}>
                <AdminSection
                  title={copy.recentFailures}
                  description={copy.recentFailuresBody}
                >
                  {data.recentFailures.length ? (
                    <View style={styles.records}>
                      {data.recentFailures.map((failure) => (
                        <AdminRecord key={failure.id} tone="error">
                          <RecordHeading
                            title={failure.videoTitle}
                            subtitle={failure.ownerEmail}
                            badge={
                              <StatusBadge
                                label={copy.retryRequired}
                                tone="error"
                              />
                            }
                          />
                          <RecordMeta
                            items={[
                              {
                                label: "Code",
                                value: failure.errorCode ?? "unknown",
                                icon: "model",
                              },
                              {
                                label: copy.updated,
                                value: new Intl.DateTimeFormat(locale, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(new Date(failure.updatedAt)),
                                icon: "time",
                              },
                            ]}
                          />
                          {failure.errorMessage ? (
                            <Text
                              style={[
                                styles.failureMessage,
                                { color: theme.textMuted },
                              ]}
                            >
                              {failure.errorMessage}
                            </Text>
                          ) : null}
                        </AdminRecord>
                      ))}
                    </View>
                  ) : (
                    <Surface tone="success">
                      <View style={styles.emptySuccess}>
                        <VoxelIcon
                          name="correct"
                          size={28}
                          color={theme.success}
                        />
                        <Text
                          style={[
                            styles.emptySuccessText,
                            { color: theme.text },
                          ]}
                        >
                          {copy.noFailures}
                        </Text>
                      </View>
                    </Surface>
                  )}
                </AdminSection>
              </View>
              <View style={styles.columnNarrow}>
                <AdminSection title={copy.activity7d}>
                  <Surface tone="tinted">
                    <View style={styles.activityList}>
                      <ActivityRow
                        label={copy.newUsers}
                        value={data.activity.newUsers7d}
                      />
                      <ActivityRow
                        label={copy.totalLessons}
                        value={data.activity.lessons7d}
                      />
                      <ActivityRow
                        label={copy.completedAttempts}
                        value={data.activity.completedAttempts7d}
                      />
                    </View>
                  </Surface>
                </AdminSection>
                <Surface tone="warning">
                  <View style={styles.protectedHeading}>
                    <VoxelIcon
                      name="password"
                      size={24}
                      color={theme.warning}
                    />
                    <Text
                      style={[styles.protectedTitle, { color: theme.text }]}
                    >
                      {copy.protectedData}
                    </Text>
                  </View>
                  <Text
                    style={[styles.protectedBody, { color: theme.textMuted }]}
                  >
                    {copy.protectedDataBody}
                  </Text>
                </Surface>
              </View>
            </AdminTwoColumn>
          </>
        ) : null}
      </AdminDataState>
    </AdminPage>
  );
}

function ActivityRow({ label, value }: { label: string; value: number }) {
  const { locale, theme } = useSettings();
  return (
    <View style={styles.activityRow}>
      <Text style={[styles.activityLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text style={[styles.activityValue, { color: theme.primary }]}>
        {value.toLocaleString(locale)}
      </Text>
    </View>
  );
}

function percentValue(value: number): string {
  return `${value.toFixed(1)}%`;
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
    marginBottom: spacing[8],
  },
  records: { gap: spacing[3] },
  columnWide: { flex: 1.6, minWidth: 0 },
  columnNarrow: { flex: 1, minWidth: 0, gap: spacing[5] },
  failureMessage: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  emptySuccess: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  emptySuccessText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  activityList: { gap: spacing[4] },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
  },
  activityLabel: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  activityValue: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  protectedHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  protectedTitle: {
    flex: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  protectedBody: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
