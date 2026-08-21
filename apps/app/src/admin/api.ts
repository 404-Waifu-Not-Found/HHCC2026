import {
  AdminAuditResponseSchema,
  AdminGenerationsResponseSchema,
  AdminJobsResponseSchema,
  AdminLessonsResponseSchema,
  AdminMeResponseSchema,
  AdminMutationResponseSchema,
  AdminOverviewResponseSchema,
  AdminSystemResponseSchema,
  AdminUsersResponseSchema,
  type AdminAuditResponse,
  type AdminGenerationsResponse,
  type AdminJobsResponse,
  type AdminLessonsResponse,
  type AdminMeResponse,
  type AdminOverviewResponse,
  type AdminRole,
  type AdminSystemResponse,
  type AdminUsersResponse,
} from "@clipquest/contracts";
import { apiRequest, jsonBody } from "../lib/api";

export type AdminListFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: AdminRole;
  status?: string;
  state?: string;
  outcome?: string;
};

export function getAdminMe(): Promise<AdminMeResponse> {
  return apiRequest("/api/admin/me", {}, AdminMeResponseSchema);
}

export function getAdminOverview(): Promise<AdminOverviewResponse> {
  return apiRequest("/api/admin/overview", {}, AdminOverviewResponseSchema);
}

export function getAdminUsers(
  filters: AdminListFilters,
): Promise<AdminUsersResponse> {
  return apiRequest(
    `/api/admin/users${query(filters)}`,
    {},
    AdminUsersResponseSchema,
  );
}

export function getAdminJobs(
  filters: AdminListFilters,
): Promise<AdminJobsResponse> {
  return apiRequest(
    `/api/admin/jobs${query(filters)}`,
    {},
    AdminJobsResponseSchema,
  );
}

export function getAdminGenerations(
  filters: AdminListFilters,
): Promise<AdminGenerationsResponse> {
  return apiRequest(
    `/api/admin/generations${query(filters)}`,
    {},
    AdminGenerationsResponseSchema,
  );
}

export function getAdminLessons(
  filters: AdminListFilters,
): Promise<AdminLessonsResponse> {
  return apiRequest(
    `/api/admin/lessons${query(filters)}`,
    {},
    AdminLessonsResponseSchema,
  );
}

export function getAdminAudit(
  filters: AdminListFilters,
): Promise<AdminAuditResponse> {
  return apiRequest(
    `/api/admin/audit${query(filters)}`,
    {},
    AdminAuditResponseSchema,
  );
}

export function getAdminSystem(): Promise<AdminSystemResponse> {
  return apiRequest("/api/admin/system", {}, AdminSystemResponseSchema);
}

export function adminMutation(path: string, body: Record<string, unknown>) {
  return apiRequest(
    path,
    { method: "POST", body: jsonBody(body) },
    AdminMutationResponseSchema,
  );
}

function query(filters: AdminListFilters): string {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") values.set(key, String(value));
  }
  const serialized = values.toString();
  return serialized ? `?${serialized}` : "";
}
