import { useCallback, useState } from "react";
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
import { getAdminAudit } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { useSettings } from "../../src/providers/SettingsProvider";

type Outcome = "all" | "success" | "failed";

export default function AdminAuditScreen() {
  const copy = useAdminCopy();
  const { locale } = useSettings();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [page, setPage] = useState(1);
  const loader = useCallback(
    () =>
      getAdminAudit({
        page,
        pageSize: 25,
        search,
        outcome: outcome === "all" ? undefined : outcome,
      }),
    [outcome, page, search],
  );
  const { data, error, loading, refresh } = useAdminData(loader);
  return (
    <AdminPage
      title={copy.audit}
      subtitle="Immutable accountability for privileged management actions."
      icon="audit"
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
          label={copy.outcome}
          value={outcome}
          onChange={(value) => {
            setPage(1);
            setOutcome(value);
          }}
          options={[
            { value: "all", label: copy.all },
            { value: "success", label: copy.success },
            { value: "failed", label: copy.failed },
          ]}
        />
      </AdminToolbar>
      <AdminDataState
        loading={loading}
        error={error}
        empty={!data?.entries.length}
        onRetry={() => void refresh()}
      >
        {data?.entries.map((entry) => (
          <AdminRecord
            key={entry.id}
            tone={entry.outcome === "failed" ? "error" : undefined}
          >
            <RecordHeading
              title={humanize(entry.action)}
              subtitle={`${entry.actor.name} · ${entry.actor.email}`}
              badge={
                <StatusBadge
                  label={
                    entry.outcome === "success" ? copy.success : copy.failed
                  }
                  tone={entry.outcome === "success" ? "success" : "error"}
                />
              }
            />
            <RecordMeta
              items={[
                {
                  label: copy.target,
                  value: `${entry.targetType}${entry.targetId ? ` · ${entry.targetId}` : ""}`,
                  icon: "target",
                },
                {
                  label: copy.reason,
                  value: entry.reason ?? "No reason recorded",
                  icon: "captions",
                },
                {
                  label: copy.updated,
                  value: formatDate(entry.createdAt, locale),
                  icon: "time",
                },
              ]}
            />
          </AdminRecord>
        ))}
      </AdminDataState>
      {data ? <Pagination {...data.pagination} onChange={setPage} /> : null}
    </AdminPage>
  );
}

function humanize(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
