import { QuizGenerationProfileResponseSchema } from "@clipquest/contracts";
import { Hono } from "hono";
import { quizGenerationProfile } from "../lib/generation-rollout";
import type { ApiBindings } from "../middleware/authenticated";

export const generationRouter = new Hono<ApiBindings>();

generationRouter.get("/profile", (c) => {
  const profile = quizGenerationProfile(c.env, c.get("user").id);
  return c.json(
    QuizGenerationProfileResponseSchema.parse({
      ...profile,
      clientRequirements: {
        chromeExtension: {
          minimumVersion: profile.minimumExtensionVersion,
          requiredCapability: profile.requiredCapability,
        },
        androidApp: {
          minimumVersion: "0.2.0",
          requiredCapability: "question-stream-v7",
        },
      },
    }),
  );
});
