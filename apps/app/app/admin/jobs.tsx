import type {
  AdminGeneration,
  AdminGenerationState,
} from "@clipquest/contracts";
import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import {
  AdminDataState,
  AdminPage,
  AdminRecord,
  AdminToolbar,
  FilterChips,
  Pagination,
  RecordHeading,
  RecordMeta,
  StatusBadge,
} from "../../src/admin/AdminUI";
import { getAdminGenerations } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { ProgressBar } from "../../src/components/ProgressBar";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

type GenerationFilter = "all" | AdminGenerationState;

export default function AdminJobsScreen() {
  const copy = useAdminCopy();
  const { locale, theme } = useSettings();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<GenerationFilter>("all");
  const [page, setPage] = useState(1);
  const loader = useCallback(
    () =>
      getAdminGenerations({
        page,
        pageSize: 20,
        search,
        state: state === "all" ? undefined : state,
      }),
    [page, search, state],
  );
  const { data, error, loading, refresh } = useAdminData(loader);

  return (
    <AdminPage
      title={copy.jobs}
      subtitle={copy.generationStreamsSubtitle}
      icon="processing"
    >
      <AdminToolbar
        search={draftSearch}
        onSearchChange={setDraftSearch}
        onSubmit={() => {
          setPage(1);
          setSearch(draftSearch.trim());
        }}
      >
        <FilterChips
          label={copy.generationState}
          value={state}
          onChange={(value) => {
            setPage(1);
            setState(value);
          }}
          options={[
            { value: "all", label: copy.all },
            { value: "generating", label: copy.generating },
            { value: "retrying", label: copy.retrying },
            { value: "recovering", label: copy.recovering },
            { value: "cooldown", label: copy.cooldown },
            { value: "retry_required", label: copy.retryRequired },
            { value: "action_required", label: copy.actionRequired },
            { value: "generation_failed", label: copy.generationFailed },
            { value: "ready", label: copy.ready },
          ]}
        />
      </AdminToolbar>
      <AdminDataState
        loading={loading}
        error={error}
        empty={!data?.generations.length}
        onRetry={() => void refresh()}
      >
        {data?.generations.map((generation) => (
          <AdminRecord
            key={generation.quizId}
            tone={
              [
                "retry_required",
                "action_required",
                "generation_failed",
              ].includes(generation.state)
                ? "error"
                : undefined
            }
          >
            <RecordHeading
              title={generation.video.title}
              subtitle={`${generation.owner.name} · ${generation.owner.email}`}
              badge={
                <StatusBadge
                  label={generationStateLabel(generation.state, copy)}
                  tone={generationTone(generation.state)}
                />
              }
            />
            <ProgressBar
              progress={generation.progress}
              accessibilityLabel={`${generation.acceptedQuestions}/${generation.plannedQuestions} ${copy.questionsReady}`}
            />
            <RecordMeta
              items={[
                {
                  label: copy.questionsReady,
                  value: `${generation.acceptedQuestions} / ${generation.plannedQuestions}`,
                  icon: "checklist",
                },
                {
                  label: copy.questionTypes,
                  value: generation.requestedQuestionTypes
                    .map(formatQuestionType)
                    .join(", "),
                  icon: "model",
                },
                {
                  label: copy.primaryCalls,
                  value: String(generation.primaryCalls),
                  icon: "processing",
                },
                {
                  label: copy.automaticRetries,
                  value: String(generation.automaticRetries),
                  icon: "time",
                },
                {
                  label: copy.automaticRecoveries,
                  value: String(generation.automaticRecoveries ?? 0),
                  icon: "refresh",
                },
                ...(generation.manualContinuations > 0
                  ? [
                      {
                        label: copy.legacyManualContinuations,
                        value: String(generation.manualContinuations),
                        icon: "refresh" as const,
                      },
                    ]
                  : []),
                {
                  label: copy.partialCalls,
                  value: String(generation.partialCalls),
                  icon: "processing",
                },
                {
                  label: copy.firstQuestionLatency,
                  value: formatDuration(generation.firstQuestionLatencyMs),
                  icon: "time",
                },
                {
                  label: copy.tokenUsage,
                  value: formatTokenUsage(generation),
                  icon: "model",
                },
                {
                  label: copy.telemetrySource,
                  value:
                    generation.telemetrySource === "authoritative_calls"
                      ? copy.authoritativeTelemetry
                      : copy.legacyTelemetry,
                  icon: "database",
                },
                {
                  label: copy.lastQuestion,
                  value: formatDate(generation.lastQuestionAt, locale),
                  icon: "checklist",
                },
                {
                  label: copy.lastCall,
                  value: generation.lastAttemptAt
                    ? formatDate(generation.lastAttemptAt, locale)
                    : "—",
                  icon: "time",
                },
                {
                  label: copy.updated,
                  value: formatDate(generation.lastProgressAt, locale),
                  icon: "time",
                },
                {
                  label: "Quiz ID",
                  value: generation.quizId,
                  icon: "database",
                },
              ]}
            />
            {generation.state === "action_required" ? (
              <Text style={[styles.note, { color: theme.textMuted }]}>
                {copy.configurationActionRequired}
                {generation.reasonCode
                  ? ` · ${generation.reasonCode.replaceAll("_", " ")}`
                  : ""}
              </Text>
            ) : generation.state === "generation_failed" ? (
              <Text style={[styles.note, { color: theme.textMuted }]}>
                {copy.automaticRecoveryFailed}
                {generation.reasonCode
                  ? ` · ${generation.reasonCode.replaceAll("_", " ")}`
                  : ""}
              </Text>
            ) : null}
            {generation.manualContinuations > 0 ? (
              <Text style={[styles.note, { color: theme.textMuted }]}>
                {copy.legacyManualContinuationsNote}
              </Text>
            ) : null}
            {Object.keys(generation.outcomeCounts).length ? (
              <Text style={[styles.note, { color: theme.textMuted }]}>
                {copy.outcomes}: {formatOutcomeCounts(generation.outcomeCounts)}
              </Text>
            ) : null}
          </AdminRecord>
        ))}
      </AdminDataState>
      {data ? <Pagination {...data.pagination} onChange={setPage} /> : null}
    </AdminPage>
  );
}

function generationStateLabel(
  state: AdminGenerationState,
  copy: ReturnType<typeof useAdminCopy>,
): string {
  if (state === "generating") return copy.generating;
  if (state === "retrying") return copy.retrying;
  if (state === "recovering") return copy.recovering;
  if (state === "cooldown") return copy.cooldown;
  if (state === "retry_required") return copy.retryRequired;
  if (state === "action_required") return copy.actionRequired;
  if (state === "generation_failed") return copy.generationFailed;
  return copy.ready;
}

function generationTone(
  state: AdminGeneration["state"],
): "neutral" | "primary" | "success" | "error" {
  if (state === "ready") return "success";
  if (
    ["retry_required", "action_required", "generation_failed"].includes(state)
  )
    return "error";
  if (state === "retrying" || state === "recovering" || state === "cooldown")
    return "neutral";
  return "primary";
}

function formatQuestionType(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function formatTokenUsage(generation: AdminGeneration): string {
  const usage = generation.tokenUsage;
  const total = usage.inputTokens + usage.outputTokens + usage.reasoningTokens;
  return `${total.toLocaleString()} · ${usage.completeCalls}/${usage.completeCalls + usage.unknownCalls} complete`;
}

function formatOutcomeCounts(outcomes: Record<string, number>): string {
  return Object.entries(outcomes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `${outcome.replaceAll("_", " ")} ${count}`)
    .join(" · ");
}

const styles = StyleSheet.create({
  note: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
    marginTop: spacing[1],
  },
});
