import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import type { ApiBindings } from "../middleware/authenticated";

export const modelsRouter = new Hono<ApiBindings>();

modelsRouter.get("/manifest", async (c) => {
  const manifest = await c.env.PRIVATE_BUCKET.get(c.env.MODEL_MANIFEST_KEY);
  if (!manifest) {
    throw new ApiError(503, "model_manifest_unavailable", "The speech model manifest is not available yet.");
  }
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "private, max-age=300",
    ETag: manifest.httpEtag,
  });
  return new Response(manifest.body, { headers });
});

modelsRouter.get("/files/*", async (c) => {
  const relativePath = c.req.path.replace(/^\/api\/models\/files\//, "");
  if (!relativePath || relativePath.includes("..") || relativePath.startsWith("/")) {
    throw new ApiError(404, "model_file_not_found", "Speech model file not found.");
  }
  const key = `models/whisper-tiny/${relativePath}`;
  const object = await c.env.PRIVATE_BUCKET.get(key, { range: c.req.raw.headers });
  if (!object) throw new ApiError(404, "model_file_not_found", "Speech model file not found.");
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: object.httpEtag,
  });
  object.writeHttpMetadata(headers);
  if (object.range && "offset" in object.range && typeof object.range.offset === "number") {
    const length = object.range.length ?? object.size - object.range.offset;
    headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
  }
  return new Response(object.body, { status: object.range ? 206 : 200, headers });
});

