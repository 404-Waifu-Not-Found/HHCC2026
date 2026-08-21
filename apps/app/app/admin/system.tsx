import { VoxelIcon } from "../../src/components/VoxelIcon";
import type { VoxelIconName } from "../../src/components/VoxelIcon";
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
                      ([name, configured]) => {
                        const optional = isOptionalConfiguration(name);
                        const available = configured || optional;
                        return (
                          <View
                            key={name}
                            style={[
                              styles.configRow,
                              { borderBottomColor: theme.divider },
                            ]}
                          >
                            <VoxelIcon
                              name={
                                configured
                                  ? "correct"
                                  : optional
                                    ? "system"
                                    : "error"
                              }
                              size={23}
                              color={
                                configured
                                  ? theme.success
                                  : optional
                                    ? theme.textMuted
                                    : theme.error
                              }
                            />
                            <Text
                              style={[styles.configName, { color: theme.text }]}
                            >
                              {formatKey(name)}
                            </Text>
                            <StatusBadge
                              label={
                                configured
                                  ? copy.configured
                                  : optional
                                    ? copy.disabled
                                    : copy.unavailable
                              }
                              tone={
                                configured
                                  ? "success"
                                  : available
                                    ? "neutral"
                                    : "error"
                              }
                            />
                          </View>
                        );
                      },
                    )}
                  </View>
                </Surface>
              </AdminSection>
              <AdminSection title={copy.generationArchitecture}>
                <Surface>
                  <View style={styles.configList}>
                    <ArchitectureRow
                      label={copy.localAiGeneration}
                      status={copy.available}
                      tone="success"
                      icon="correct"
                    />
                    <ArchitectureRow
                      label={copy.workerGeneration}
                      status={copy.disabledByDesign}
                      tone="neutral"
                      icon="system"
                    />
                    <ArchitectureRow
                      label={copy.extensionRequirement}
                      status={copy.required}
                      tone="primary"
                      icon="processing"
                    />
                  </View>
                </Surface>
              </AdminSection>
            </View>
            <View style={styles.column}>
              <AdminSection title={copy.queueHealth}>
                <View style={styles.jobStats}>
                  <StatTile
                    value={String(data.generation.states.generating)}
                    label={copy.generating}
                  />
                  <StatTile
                    value={String(data.generation.states.retrying)}
                    label={copy.retrying}
                    tone="secondary"
                  />
                  <StatTile
                    value={String(data.generation.states.recovering)}
                    label={copy.recovering}
                    tone="secondary"
                  />
                  <StatTile
                    value={String(data.generation.states.cooldown)}
                    label={copy.cooldown}
                    tone="secondary"
                  />
                  <StatTile
                    value={String(data.generation.states.ready)}
                    label={copy.ready}
                    tone="success"
                  />
                  <StatTile
                    value={String(data.generation.states.retryRequired)}
                    label={copy.retryRequired}
                    tone="warning"
                  />
                  <StatTile
                    value={String(data.generation.states.actionRequired)}
                    label={copy.actionRequired}
                    tone="warning"
                  />
                  <StatTile
                    value={String(data.generation.states.generationFailed)}
                    label={copy.generationFailed}
                    tone="warning"
                  />
                </View>
              </AdminSection>
              <Surface tone="tinted">
                <View style={styles.detailList}>
                  <SystemDetail
                    icon="model"
                    label={copy.model}
                    value={data.generation.model}
                  />
                  <SystemDetail
                    icon="processing"
                    label={copy.pipeline}
                    value={String(data.generation.pipelineVersion)}
                  />
                  <SystemDetail
                    icon="model"
                    label={copy.promptVersion}
                    value={data.generation.promptVersion}
                  />
                  <SystemDetail
                    icon="checklist"
                    label={copy.validatorVersion}
                    value={data.generation.validatorVersion}
                  />
                  <SystemDetail
                    icon="processing"
                    label={copy.generationRollout}
                    value={data.generation.rolloutMode}
                  />
                  <SystemDetail
                    icon="system"
                    label={copy.workerVersion}
                    value={
                      data.worker.versionTag
                        ? `${data.worker.versionId} · ${data.worker.versionTag}`
                        : data.worker.versionId
                    }
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
  icon: VoxelIconName;
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

function ArchitectureRow({
  label,
  status,
  tone,
  icon,
}: {
  label: string;
  status: string;
  tone: "neutral" | "primary" | "success";
  icon: VoxelIconName;
}) {
  const { theme } = useSettings();
  return (
    <View style={[styles.configRow, { borderBottomColor: theme.divider }]}>
      <VoxelIcon name={icon} size={23} color={theme.primary} />
      <Text style={[styles.configName, { color: theme.text }]}>{label}</Text>
      <StatusBadge label={status} tone={tone} />
    </View>
  );
}

function isOptionalConfiguration(name: string): boolean {
  return name === "youtubeEncryption" || name === "youtubeDemoHistory";
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
