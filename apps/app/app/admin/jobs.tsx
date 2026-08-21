import type { AdminJob } from "@clipquest/contracts";
import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import {
  ActionDialog,
  AdminDataState,
  AdminPage,
  AdminRecord,
  AdminToolbar,
  FilterChips,
  InlineActions,
  Notice,
  Pagination,
  RecordHeading,
  RecordMeta,
  StatusBadge,
} from "../../src/admin/AdminUI";
import { adminMutation, getAdminJobs } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressBar } from "../../src/components/ProgressBar";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

type JobState = "all" | "queued" | "running" | "complete" | "failed";

export default function AdminJobsScreen() {
  const copy = useAdminCopy();
  const { locale, theme } = useSettings();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<JobState>("all");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{
    type: "retry" | "cancel";
    job: AdminJob;
  }>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const loader = useCallback(
    () =>
      getAdminJobs({
        page,
        pageSize: 20,
        search,
        state: state === "all" ? undefined : state,
      }),
    [page, search, state],
  );
  const { data, error, loading, refresh } = useAdminData(loader);

  const submitAction = async () => {
    if (!action || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await adminMutation(`/api/admin/jobs/${action.job.id}/${action.type}`, {
        reason: reason.trim(),
      });
      setAction(undefined);
      setNotice(copy.actionSucceeded);
      await refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : copy.actionFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      title={copy.jobs}
      subtitle="Inspect durable generation work and recover stalled learning journeys."
      icon="processing"
    >
      {notice ? <Notice tone="success" text={notice} /> : null}
      <AdminToolbar
        search={draftSearch}
        onSearchChange={setDraftSearch}
        onSubmit={() => {
          setPage(1);
          setSearch(draftSearch.trim());
        }}
      >
        <FilterChips
          label="Job state"
          value={state}
          onChange={(value) => {
            setPage(1);
            setState(value);
          }}
          options={[
            { value: "all", label: copy.all },
            { value: "queued", label: copy.queued },
            { value: "running", label: copy.running },
            { value: "complete", label: copy.complete },
            { value: "failed", label: copy.failed },
          ]}
        />
      </AdminToolbar>
      <AdminDataState
        loading={loading}
        error={error}
        empty={!data?.jobs.length}
        onRetry={() => void refresh()}
      >
        {data?.jobs.map((job) => (
          <AdminRecord
            key={job.id}
            tone={job.state === "failed" ? "error" : undefined}
          >
            <RecordHeading
              title={job.video.title}
              subtitle={`${job.owner.name} · ${job.owner.email}`}
              badge={
                <StatusBadge
                  label={copy[job.state]}
                  tone={jobTone(job.state)}
                />
              }
              actions={
                job.state === "complete" ? null : (
                  <InlineActions>
                    {!job.cancelRequested ? (
                      <PrimaryButton
                        compact
                        variant="secondary"
                        disabled={job.state === "running"}
                        onPress={() => {
                          setAction({ type: "retry", job });
                          setReason("");
                          setActionError(undefined);
                        }}
                      >
                        {copy.retryJob}
                      </PrimaryButton>
                    ) : null}
                    {job.state !== "failed" ? (
                      <PrimaryButton
                        compact
                        variant="danger"
                        onPress={() => {
                          setAction({ type: "cancel", job });
                          setReason("");
                          setActionError(undefined);
                        }}
                      >
                        {copy.cancelJob}
                      </PrimaryButton>
                    ) : null}
                  </InlineActions>
                )
              }
            />
            <ProgressBar
              progress={job.progress}
              accessibilityLabel={`${copy.progress} ${Math.round(job.progress * 100)}%`}
            />
            <RecordMeta
              items={[
                {
                  label: "Platform",
                  value:
                    job.video.source === "youtube" ? "YouTube" : "Bilibili",
                  icon: "video",
                },
                {
                  label: "Stage",
                  value: job.stage.replaceAll("_", " "),
                  icon: "processing",
                },
                {
                  label: copy.updated,
                  value: formatDate(job.updatedAt, locale),
                  icon: "time",
                },
                { label: "Job ID", value: job.id, icon: "database" },
              ]}
            />
            {job.errorMessage ? (
              <Text
                accessibilityRole="alert"
                style={[styles.errorMessage, { color: theme.error }]}
              >
                {job.errorCode ?? "generation_failed"}: {job.errorMessage}
              </Text>
            ) : null}
          </AdminRecord>
        ))}
      </AdminDataState>
      {data ? <Pagination {...data.pagination} onChange={setPage} /> : null}
      <ActionDialog
        visible={Boolean(action)}
        title={action?.type === "cancel" ? copy.cancelJob : copy.retryJob}
        description={
          action
            ? `${action.job.video.title} · ${action.job.owner.email}`
            : copy.operationsSubtitle
        }
        confirmLabel={
          action?.type === "cancel" ? copy.cancelJob : copy.retryJob
        }
        confirmVariant={action?.type === "cancel" ? "danger" : "secondary"}
        reason={reason}
        onReasonChange={setReason}
        onClose={() => {
          if (!busy) setAction(undefined);
        }}
        onConfirm={() => void submitAction()}
        busy={busy}
        error={actionError}
      />
    </AdminPage>
  );
}

function jobTone(
  state: AdminJob["state"],
): "neutral" | "primary" | "success" | "error" {
  if (state === "complete") return "success";
  if (state === "failed") return "error";
  if (state === "running") return "primary";
  return "neutral";
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  errorMessage: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
    marginTop: spacing[1],
  },
});
