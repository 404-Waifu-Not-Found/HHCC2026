import { QuizGenerationProfileResponseSchema } from "@clipquest/contracts";
import { Hono } from "hono";
import { quizGenerationProfile } from "../lib/generation-rollout";
import type { ApiBindings } from "../middleware/authenticated";

export const generationRouter = new Hono<ApiBindings>();

generationRouter.get("/profile", (c) =>
  c.json(
    QuizGenerationProfileResponseSchema.parse(
      quizGenerationProfile(c.env, c.get("user").id),
    ),
  ),
);
