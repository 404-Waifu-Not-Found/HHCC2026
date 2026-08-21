import type { MiddlewareHandler } from "hono";
import { createAuth } from "../auth";
import { ApiError } from "../lib/errors";
import type { AppEnv, AuthUser } from "../types";

export type ApiVariables = {
  user: AuthUser;
};

export type ApiBindings = {
  Bindings: AppEnv;
  Variables: ApiVariables;
};

export const authenticated: MiddlewareHandler<ApiBindings> = async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new ApiError(401, "authentication_required", "Please sign in to continue.");
  }
  if (!session.user.emailVerified) {
    throw new ApiError(403, "email_verification_required", "Verify your email before creating a quiz.");
  }
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    username: "username" in session.user && typeof session.user.username === "string" ? session.user.username : null,
  });
  await next();
};
