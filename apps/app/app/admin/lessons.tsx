import { useCallback, useState } from "react";
import {
  AdminDataState,
  AdminPage,
  AdminRecord,
  AdminToolbar,
  Pagination,
  RecordHeading,
  RecordMeta,
  StatusBadge,
} from "../../src/admin/AdminUI";
import { getAdminLessons } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { useSettings } from "../../src/providers/SettingsProvider";

export default function AdminLessonsScreen() {
  const copy = useAdminCopy();
  const { locale } = useSettings();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const loader = useCallback(
    () => getAdminLessons({ page, pageSize: 20, search }),
    [page, search],
  );
  const { data, error, loading, refresh } = useAdminData(loader);
  return (
    <AdminPage
      title={copy.lessons}
      subtitle="Read-only lesson inventory with ownership and engagement summaries."
      icon="lessons"
    >
      <AdminToolbar
        search={draftSearch}
        onSearchChange={setDraftSearch}
        onSubmit={() => {
          setPage(1);
          setSearch(draftSearch.trim());
        }}
      />
      <AdminDataState
        loading={loading}
        error={error}
        empty={!data?.lessons.length}
        onRetry={() => void refresh()}
      >
        {data?.lessons.map((lesson) => (
          <AdminRecord key={lesson.id}>
            <RecordHeading
              title={lesson.video.title}
              subtitle={`${lesson.owner.name} · ${lesson.owner.email}`}
              badge={<StatusBadge label="YouTube" tone="primary" />}
            />
            <RecordMeta
              items={[
                {
                  label: copy.questions,
                  value: String(lesson.questionCount),
                  icon: "help",
                },
                {
                  label: copy.attempts,
                  value: String(lesson.attemptCount),
                  icon: "checklist",
                },
                {
                  label: copy.language,
                  value: lesson.language,
                  icon: "translation",
                },
                {
                  label: "Session",
                  value: lesson.sessionLength,
                  icon: "checklist",
                },
                {
                  label: "Context",
                  value: lesson.watched ? copy.watched : copy.notWatched,
                  icon: "help",
                },
                {
                  label: copy.updated,
                  value: formatDate(lesson.createdAt, locale),
                  icon: "calendar",
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

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
