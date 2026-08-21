import type { AdminRole, AdminUser } from "@clipquest/contracts";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAdminSession } from "../../src/admin/AdminShell";
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
import { adminMutation, getAdminUsers } from "../../src/admin/api";
import { useAdminCopy } from "../../src/admin/copy";
import { useAdminData } from "../../src/admin/useAdminData";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing } from "../../src/theme/tokens";

type UserAction = "ban" | "unban" | "revoke-sessions" | "role";

export default function AdminUsersScreen() {
  const copy = useAdminCopy();
  const me = useAdminSession();
  const { locale } = useSettings();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"all" | AdminRole>("all");
  const [status, setStatus] = useState<"all" | "active" | "banned">("all");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{ type: UserAction; user: AdminUser }>();
  const [reason, setReason] = useState("");
  const [nextRole, setNextRole] = useState<AdminRole>("user");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const loader = useCallback(
    () =>
      getAdminUsers({
        page,
        pageSize: 20,
        search,
        role: role === "all" ? undefined : role,
        status: status === "all" ? undefined : status,
      }),
    [page, role, search, status],
  );
  const { data, error, loading, refresh } = useAdminData(loader);

  const openAction = (type: UserAction, user: AdminUser) => {
    setAction({ type, user });
    setReason("");
    setNextRole(user.role);
    setActionError(undefined);
  };

  const closeAction = () => {
    if (busy) return;
    setAction(undefined);
    setActionError(undefined);
  };

  const submitAction = async () => {
    if (!action || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const path =
        action.type === "role"
          ? `/api/admin/users/${action.user.id}/role`
          : `/api/admin/users/${action.user.id}/${action.type}`;
      await adminMutation(path, {
        reason: reason.trim(),
        ...(action.type === "role" ? { role: nextRole } : {}),
      });
      setNotice(copy.actionSucceeded);
      setAction(undefined);
      await refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : copy.actionFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  const submitSearch = () => {
    setPage(1);
    setSearch(draftSearch.trim());
  };

  return (
    <AdminPage
      title={copy.users}
      subtitle="Review accounts and apply reversible, audited moderation actions."
      icon="account-group-outline"
    >
      {notice ? <Notice tone="success" text={notice} /> : null}
      <AdminToolbar
        search={draftSearch}
        onSearchChange={setDraftSearch}
        onSubmit={submitSearch}
      >
        <View style={styles.filterStack}>
          <FilterChips
            label={copy.role}
            value={role}
            onChange={(value) => {
              setPage(1);
              setRole(value);
            }}
            options={[
              { value: "all", label: copy.all },
              { value: "user", label: copy.user },
              { value: "admin", label: copy.admin },
              { value: "owner", label: copy.owner },
            ]}
          />
          <FilterChips
            label="Account status"
            value={status}
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            options={[
              { value: "all", label: copy.all },
              { value: "active", label: copy.active },
              { value: "banned", label: copy.banned },
            ]}
          />
        </View>
      </AdminToolbar>

      <AdminDataState
        loading={loading}
        error={error}
        empty={!data?.users.length}
        onRetry={() => void refresh()}
      >
        {data?.users.map((user) => (
          <AdminRecord key={user.id} tone={user.banned ? "error" : undefined}>
            <RecordHeading
              title={user.name}
              subtitle={user.email}
              badge={
                <InlineActions>
                  <StatusBadge
                    label={copy[user.role]}
                    tone={
                      user.role === "owner"
                        ? "warning"
                        : user.role === "admin"
                          ? "primary"
                          : "neutral"
                    }
                  />
                  {user.banned ? (
                    <StatusBadge label={copy.banned} tone="error" />
                  ) : null}
                  <StatusBadge
                    label={user.emailVerified ? copy.verified : copy.unverified}
                    tone={user.emailVerified ? "success" : "warning"}
                  />
                </InlineActions>
              }
              actions={
                user.id === me.user.id ? null : (
                  <InlineActions>
                    <PrimaryButton
                      compact
                      variant={user.banned ? "secondary" : "danger"}
                      onPress={() =>
                        openAction(user.banned ? "unban" : "ban", user)
                      }
                    >
                      {user.banned ? copy.restore : copy.suspend}
                    </PrimaryButton>
                    <PrimaryButton
                      compact
                      variant="ghost"
                      onPress={() => openAction("revoke-sessions", user)}
                    >
                      {copy.revokeSessions}
                    </PrimaryButton>
                    {me.permissions.includes("users:set-role") ? (
                      <PrimaryButton
                        compact
                        variant="ghost"
                        onPress={() => openAction("role", user)}
                      >
                        {copy.changeRole}
                      </PrimaryButton>
                    ) : null}
                  </InlineActions>
                )
              }
            />
            <RecordMeta
              items={[
                {
                  label: copy.joined,
                  value: formatDate(user.createdAt, locale),
                  icon: "calendar-outline",
                },
                {
                  label: copy.lastSeen,
                  value: user.lastSeenAt
                    ? formatDate(user.lastSeenAt, locale)
                    : copy.never,
                  icon: "clock-outline",
                },
                {
                  label: copy.lessons,
                  value: String(user.lessonCount),
                  icon: "book-open-outline",
                },
                {
                  label: copy.attempts,
                  value: String(user.attemptCount),
                  icon: "clipboard-check-outline",
                },
              ]}
            />
          </AdminRecord>
        ))}
      </AdminDataState>
      {data ? (
        <Pagination
          {...data.pagination}
          onChange={(next) => {
            setPage(next);
          }}
        />
      ) : null}

      <ActionDialog
        visible={Boolean(action)}
        title={dialogTitle(action?.type, copy)}
        description={
          action
            ? `${action.user.name} · ${action.user.email}`
            : copy.operationsSubtitle
        }
        confirmLabel={
          action?.type === "ban"
            ? copy.suspend
            : action?.type === "unban"
              ? copy.restore
              : action?.type === "revoke-sessions"
                ? copy.revokeSessions
                : copy.changeRole
        }
        confirmVariant={action?.type === "ban" ? "danger" : "secondary"}
        reason={reason}
        onReasonChange={setReason}
        onClose={closeAction}
        onConfirm={() => void submitAction()}
        busy={busy}
        error={actionError}
      >
        {action?.type === "role" ? (
          <FilterChips<AdminRole>
            label={copy.role}
            value={nextRole}
            onChange={setNextRole}
            options={
              [
                { value: "user", label: copy.user },
                { value: "admin", label: copy.admin },
                { value: "owner", label: copy.owner },
              ] as const
            }
          />
        ) : null}
      </ActionDialog>
    </AdminPage>
  );
}

function dialogTitle(
  type: UserAction | undefined,
  copy: ReturnType<typeof useAdminCopy>,
): string {
  if (type === "ban") return copy.suspend;
  if (type === "unban") return copy.restore;
  if (type === "revoke-sessions") return copy.revokeSessions;
  return copy.changeRole;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  filterStack: { gap: spacing[2] },
});
