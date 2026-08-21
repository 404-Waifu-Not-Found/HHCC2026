import { VoxelIcon } from "../../src/components/VoxelIcon";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AdminDataState,
  AdminPage,
  AdminSection,
  AdminTwoColumn,
  StatusBadge,
} from "../../src/admin/AdminUI";
import { getAdminSystem } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { StatTile } from "../../src/components/StatTile";
import { Surface } from "../../src/components/Surface";
import { useSettings } from "../../src/providers/SettingsProvider";
import { borders, spacing, typography } from "../../src/theme/tokens";

export default function AdminSystemScreen() {
  const copy = useAdminCopy();
  const { theme } = useSettings();
  const loader = useCallback(() => getAdminSystem(), []);
  const { data, error, loading, refresh } = useAdminData(loader);
  return (
    <AdminPage
      title={copy.system}
      subtitle="Read-only service health without secret values."
      icon="system"
    >
      <AdminDataState
        loading={loading}
        error={error}
        empty={false}
        onRetry={() => void refresh()}
      >
        {data ? (
          <AdminTwoColumn>
            <View style={styles.column}>
              <AdminSection title={copy.configuration}>
                <Surface>
                  <View style={styles.configList}>
                    {Object.entries(data.configuration).map(
                      ([name, configured]) => (
                        <View
                          key={name}
                          style={[
                            styles.configRow,
                            { borderBottomColor: theme.divider },
                          ]}
                        >
                          <VoxelIcon
                            name={configured ? "correct" : "error"}
                            size={23}
                            color={configured ? theme.success : theme.error}
                          />
                          <Text
                            style={[styles.configName, { color: theme.text }]}
                          >
                            {formatKey(name)}
                          </Text>
                          <StatusBadge
                            label={
                              configured ? copy.configured : copy.unavailable
                            }
                            tone={configured ? "success" : "error"}
                          />
                        </View>
                      ),
                    )}
                  </View>
                </Surface>
              </AdminSection>
            </View>
            <View style={styles.column}>
              <AdminSection title={copy.queueHealth}>
                <View style={styles.jobStats}>
                  <StatTile
                    value={String(data.jobs.queued)}
                    label={copy.queued}
                  />
                  <StatTile
                    value={String(data.jobs.running)}
                    label={copy.running}
                    tone="secondary"
                  />
                  <StatTile
                    value={String(data.jobs.complete)}
                    label={copy.complete}
                    tone="success"
                  />
                  <StatTile
                    value={String(data.jobs.failed)}
                    label={copy.failed}
                    tone="warning"
                  />
                </View>
              </AdminSection>
              <Surface tone="tinted">
                <View style={styles.detailList}>
                  <SystemDetail
                    icon="model"
                    label={copy.model}
                    value={data.model}
                  />
                  <SystemDetail
                    icon="database"
                    label={copy.database}
                    value={data.database.migration}
                  />
                  <SystemDetail
                    icon="checklist"
                    label={copy.audit}
                    value={copy.active}
                  />
                </View>
              </Surface>
            </View>
          </AdminTwoColumn>
        ) : null}
      </AdminDataState>
    </AdminPage>
  );
}

function SystemDetail({
  icon,
  label,
  value,
}: {
  icon: "model" | "database" | "checklist";
  label: string;
  value: string;
}) {
  const { theme } = useSettings();
  return (
    <View style={styles.detailRow}>
      <VoxelIcon name={icon} size={22} color={theme.primary} />
      <View style={styles.detailCopy}>
        <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
          {label}
        </Text>
        <Text selectable style={[styles.detailValue, { color: theme.text }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function formatKey(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  column: { flex: 1, minWidth: 0, gap: spacing[5] },
  configList: { gap: spacing[1] },
  configRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderBottomWidth: borders.hairline,
    paddingVertical: spacing[2],
  },
  configName: {
    flex: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  jobStats: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  detailList: { gap: spacing[4] },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  detailCopy: { minWidth: 0, flex: 1, gap: spacing[1] },
  detailLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailValue: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
});
