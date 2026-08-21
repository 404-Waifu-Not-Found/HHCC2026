import { z } from "zod";

export const AdminRoleSchema = z.enum(["user", "admin", "owner"]);
export type AdminRole = z.infer<typeof AdminRoleSchema>;

export const AdminPermissionSchema = z.enum([
  "overview:read",
  "users:read",
  "users:moderate",
  "users:set-role",
  "jobs:read",
  "jobs:manage",
  "lessons:read",
  "audit:read",
  "system:read",
]);
export type AdminPermission = z.infer<typeof AdminPermissionSchema>;

const NullableDateSchema = z.string().datetime().nullable();

export const AdminMeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    role: AdminRoleSchema,
  }),
  permissions: z.array(AdminPermissionSchema),
});
export type AdminMeResponse = z.infer<typeof AdminMeResponseSchema>;

export const AdminOverviewResponseSchema = z.object({
  totals: z.object({
    users: z.number().int().nonnegative(),
    lessons: z.number().int().nonnegative(),
    activeJobs: z.number().int().nonnegative(),
    failedJobs: z.number().int().nonnegative(),
  }),
  activity: z.object({
    newUsers7d: z.number().int().nonnegative(),
    lessons7d: z.number().int().nonnegative(),
    completedAttempts7d: z.number().int().nonnegative(),
  }),
  recentFailures: z.array(
    z.object({
      id: z.string(),
      videoTitle: z.string(),
      ownerEmail: z.string().email(),
      errorCode: z.string().nullable(),
      errorMessage: z.string().nullable(),
      updatedAt: z.string().datetime(),
    }),
  ),
});
export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponseSchema>;

export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  username: z.string().nullable(),
  role: AdminRoleSchema,
  banned: z.boolean(),
  banReason: z.string().nullable(),
  banExpiresAt: NullableDateSchema,
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
  lastSeenAt: NullableDateSchema,
  lessonCount: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export const AdminUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
  pagination: PaginationSchema,
});
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

export const AdminJobStateSchema = z.enum([
  "queued",
  "running",
  "complete",
  "failed",
]);
export const AdminJobSchema = z.object({
  id: z.string(),
  state: AdminJobStateSchema,
  stage: z.string(),
  progress: z.number().min(0).max(1),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  cancelRequested: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  owner: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }),
  video: z.object({
    id: z.string(),
    title: z.string(),
    source: z.literal("youtube"),
  }),
});
export type AdminJob = z.infer<typeof AdminJobSchema>;

export const AdminJobsResponseSchema = z.object({
  jobs: z.array(AdminJobSchema),
  pagination: PaginationSchema,
});
export type AdminJobsResponse = z.infer<typeof AdminJobsResponseSchema>;

export const AdminGenerationStateSchema = z.enum([
  "generating",
  "retrying",
  "recovering",
  "cooldown",
  "retry_required",
  "action_required",
  "generation_failed",
  "ready",
]);
export type AdminGenerationState = z.infer<typeof AdminGenerationStateSchema>;

export const AdminGenerationSchema = z
  .object({
    quizId: z.string().uuid(),
    state: AdminGenerationStateSchema,
    acceptedQuestions: z.number().int().min(1).max(15),
    plannedQuestions: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    progress: z.number().min(0).max(1),
    requestedQuestionTypes: z
      .array(z.enum(["multiple_choice", "true_false", "short_answer"]))
      .min(1)
      .max(3),
    aiCalls: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    elapsedMs: z.number().int().nonnegative(),
    telemetrySource: z.enum(["authoritative_calls", "legacy_summary"]),
    primaryCalls: z.number().int().nonnegative(),
    automaticRetries: z.number().int().nonnegative(),
    automaticRecoveries: z.number().int().nonnegative().optional(),
    // Historical rows remain immutable. This compatibility classification
    // does not prove that a learner clicked a continuation control.
    manualContinuations: z.number().int().nonnegative(),
    partialCalls: z.number().int().nonnegative(),
    outcomeCounts: z.record(
      z.string().regex(/^[a-z0-9_]{1,64}$/),
      z.number().int().nonnegative(),
    ),
    tokenUsage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        reasoningTokens: z.number().int().nonnegative(),
        completeCalls: z.number().int().nonnegative(),
        unknownCalls: z.number().int().nonnegative(),
        complete: z.boolean(),
      })
      .strict(),
    firstQuestionLatencyMs: z.number().int().nonnegative().nullable(),
    reasonCode: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .nullable(),
    stalled: z.boolean(),
    lastProgressAt: z.string().datetime(),
    lastQuestionAt: z.string().datetime(),
    lastAttemptAt: z.string().datetime().nullable(),
    stateChangedAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    owner: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      })
      .strict(),
    video: z
      .object({
        id: z.string(),
        title: z.string(),
        source: z.literal("youtube"),
      })
      .strict(),
  })
  .strict();
export type AdminGeneration = z.infer<typeof AdminGenerationSchema>;

export const AdminGenerationsResponseSchema = z
  .object({
    generations: z.array(AdminGenerationSchema),
    pagination: PaginationSchema,
  })
  .strict();
export type AdminGenerationsResponse = z.infer<
  typeof AdminGenerationsResponseSchema
>;

export const AdminLessonSchema = z.object({
  id: z.string(),
  language: z.string(),
  sessionLength: z.string(),
  watched: z.boolean(),
  createdAt: z.string().datetime(),
  questionCount: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  owner: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }),
  video: z.object({
    id: z.string(),
    title: z.string(),
    source: z.literal("youtube"),
  }),
});
export type AdminLesson = z.infer<typeof AdminLessonSchema>;

export const AdminLessonsResponseSchema = z.object({
  lessons: z.array(AdminLessonSchema),
  pagination: PaginationSchema,
});
export type AdminLessonsResponse = z.infer<typeof AdminLessonsResponseSchema>;

export const AdminAuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  outcome: z.enum(["success", "failed"]),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  actor: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

export const AdminAuditResponseSchema = z.object({
  entries: z.array(AdminAuditEntrySchema),
  pagination: PaginationSchema,
});
export type AdminAuditResponse = z.infer<typeof AdminAuditResponseSchema>;

export const AdminSystemResponseSchema = z.object({
  configuration: z.object({
    authentication: z.boolean(),
    generation: z.boolean(),
    email: z.boolean(),
    youtubeEncryption: z.boolean(),
    youtubeDemoHistory: z.boolean(),
  }),
  model: z.string(),
  jobs: z.record(AdminJobStateSchema, z.number().int().nonnegative()),
  database: z.object({ migration: z.string(), auditEnabled: z.literal(true) }),
  generation: z
    .object({
      mode: z.literal("extension_local"),
      backendEnabled: z.literal(false),
      extensionEnabled: z.literal(true),
      extensionRequired: z.literal(true),
      model: z.string(),
      pipelineVersion: z.number().int().positive(),
      promptVersion: z.string(),
      validatorVersion: z.string(),
      rolloutMode: z.enum(["disabled", "canary", "enabled"]),
      supportedProfile: z.literal("concept_first_auto_v5_8"),
      supportedPromptVersion: z.literal("quiz-local-json-stream-v5.8"),
      supportedValidatorVersion: z.literal("validator-local-progressive-v4.7"),
      effectiveDefaultProfile: z.enum([
        "legacy_reasoning_v5_1",
        "stable_non_thinking_v5_2",
        "stable_auto_recovery_v5_3",
        "evidence_grounded_auto_v5_4",
        "concept_first_auto_v5_8",
      ]),
      requiredExtensionVersion: z.literal("0.8.8"),
      requiredCapability: z.literal("question-stream-v6"),
      states: z.object({
        generating: z.number().int().nonnegative(),
        retrying: z.number().int().nonnegative(),
        recovering: z.number().int().nonnegative(),
        cooldown: z.number().int().nonnegative(),
        retryRequired: z.number().int().nonnegative(),
        actionRequired: z.number().int().nonnegative(),
        generationFailed: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
      }),
    })
    .strict(),
  worker: z
    .object({
      versionId: z.string().min(1).max(128),
      versionTag: z.string().min(1).max(128).nullable(),
    })
    .strict(),
});
export type AdminSystemResponse = z.infer<typeof AdminSystemResponseSchema>;

export const AdminReasonRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const AdminSetRoleRequestSchema = z.object({
  role: AdminRoleSchema,
  reason: z.string().trim().min(3).max(500),
});

export const AdminMutationResponseSchema = z.object({ ok: z.literal(true) });
export type AdminMutationResponse = z.infer<typeof AdminMutationResponseSchema>;
