import { identifyVideoSource } from "@clipquest/contracts";
import { z } from "zod";

export const PENDING_VIDEO_HANDOFF_TTL_MS = 2 * 60 * 60 * 1_000;

const YouTubeUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => Boolean(identifyVideoSource(value)), {
    message: "Only a valid YouTube URL can be handed off.",
  });

export const PendingVideoHandoffV2Schema = z
  .object({
    id: z.string().uuid(),
    url: YouTubeUrlSchema,
    source: z.enum(["welcome", "quick_open"]),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    state: z.enum(["pending", "in_flight", "retry_required"]),
    claimedUserId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = value.expiresAt - value.createdAt;
    if (lifetime <= 0 || lifetime > PENDING_VIDEO_HANDOFF_TTL_MS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "The handoff lifetime is invalid.",
      });
    }
  });

export type PendingVideoHandoffV2 = z.infer<typeof PendingVideoHandoffV2Schema>;

export function createPendingVideoHandoffRecord(input: {
  id: string;
  url: string;
  source: PendingVideoHandoffV2["source"];
  claimedUserId?: string;
  nowMs?: number;
}): PendingVideoHandoffV2 {
  const createdAt = input.nowMs ?? Date.now();
  return PendingVideoHandoffV2Schema.parse({
    id: input.id,
    url: input.url,
    source: input.source,
    createdAt,
    expiresAt: createdAt + PENDING_VIDEO_HANDOFF_TTL_MS,
    state: "pending",
    ...(input.claimedUserId ? { claimedUserId: input.claimedUserId } : {}),
  });
}

export function claimPendingVideoHandoffRecord(
  record: PendingVideoHandoffV2,
  userId: string,
  nowMs = Date.now(),
): PendingVideoHandoffV2 | null {
  const parsed = PendingVideoHandoffV2Schema.safeParse(record);
  if (
    !parsed.success ||
    parsed.data.expiresAt <= nowMs ||
    (parsed.data.claimedUserId && parsed.data.claimedUserId !== userId)
  ) {
    return null;
  }
  return PendingVideoHandoffV2Schema.parse({
    ...parsed.data,
    claimedUserId: userId,
  });
}
