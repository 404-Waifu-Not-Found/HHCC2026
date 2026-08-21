import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkerPreviewUrl } from "./worker-preview-url.mjs";

test("uses the preview URL reported by Wrangler", () => {
  assert.equal(
    resolveWorkerPreviewUrl({
      uploadOutput:
        "Version Preview URL: https://build-clipquest.example.workers.dev,",
      alias: "ignored",
      workerName: "ignored",
      accountSubdomain: "ignored",
    }),
    "https://build-clipquest.example.workers.dev",
  );
});

test("derives an aliased preview URL when Wrangler omits it", () => {
  assert.equal(
    resolveWorkerPreviewUrl({
      uploadOutput: "Worker Version ID: 00000000-0000-0000-0000-000000000000",
      alias: "cq-f6c4dba0b214",
      workerName: "clipquest",
      accountSubdomain: "unoxyrich",
    }),
    "https://cq-f6c4dba0b214-clipquest.unoxyrich.workers.dev",
  );
});

test("rejects unsafe derived preview labels", () => {
  assert.throws(
    () =>
      resolveWorkerPreviewUrl({
        uploadOutput: "",
        alias: "bad alias",
        workerName: "clipquest",
        accountSubdomain: "unoxyrich",
      }),
    /Invalid alias/u,
  );
});
