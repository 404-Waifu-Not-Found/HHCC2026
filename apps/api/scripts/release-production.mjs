import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pollWorkerAssetShells,
  probeWorkerAssetShells,
  retryWorkerAssetProbe,
} from "./probe-worker-assets.mjs";
import { pushedReferenceForHead } from "./release-git-ref.mjs";
import { resolveWorkerPreviewUrl } from "./worker-preview-url.mjs";

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceRoot = path.resolve(apiRoot, "../..");
const productionOrigin = "https://clipquest.ccwu.cc";
const workerName = "clipquest";
const workersDevAccountSubdomain = "unoxyrich";
const evidence = {
  startedAt: new Date().toISOString(),
  steps: [],
};
let previousVersion;
let newVersion;
let deploymentChanged = false;

try {
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]);
  if (dirty.trim()) {
    throw new Error("Release requires a clean working tree.");
  }
  const sha = git(["rev-parse", "HEAD"]).trim();
  const branch = git(["branch", "--show-current"]).trim();
  const pushedReference = pushedReferenceForHead(branch);
  const pushedSha = git(["rev-parse", pushedReference]).trim();
  if (sha !== pushedSha) {
    throw new Error(
      `Release requires the exact HEAD commit to match ${pushedReference}.`,
    );
  }
  evidence.gitSha = sha;

  run("npm", ["run", "build"], workspaceRoot);
  run("npx", ["wrangler", "deploy", "--dry-run"], apiRoot);
  const extensionArchive = path.join(
    workspaceRoot,
    "apps/extension/dist/clipquest-captions-extension.zip",
  );
  const extensionManifest = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "apps/extension/manifest.json"),
      "utf8",
    ),
  );
  evidence.extension = {
    version: extensionManifest.version,
    sha256: createHash("sha256")
      .update(await readFile(extensionArchive))
      .digest("hex"),
  };
  evidence.steps.push({ name: "local_build_and_dry_run", ok: true });

  const deployment = wranglerJson(["deployments", "status", "--json"]);
  const active = deployment.versions?.filter(
    (version) => Number(version.percentage) === 100,
  );
  if (!active || active.length !== 1 || deployment.versions.length !== 1) {
    throw new Error(
      "Release requires one previously deployed Worker version at 100%.",
    );
  }
  previousVersion = active[0].version_id;
  evidence.previousVersion = previousVersion;

  const beforeVersions = new Set(
    wranglerJson(["versions", "list", "--json"]).map((version) => version.id),
  );
  const alias = `cq-${sha.slice(0, 12)}`;
  const uploadOutput = run(
    "npx",
    [
      "wrangler",
      "versions",
      "upload",
      "--strict",
      "--tag",
      sha,
      "--message",
      `Release ${sha}`,
      "--preview-alias",
      alias,
    ],
    apiRoot,
    true,
  );
  const afterVersions = wranglerJson(["versions", "list", "--json"]);
  const uploaded = afterVersions.filter(
    (version) => !beforeVersions.has(version.id),
  );
  if (uploaded.length !== 1) {
    throw new Error(
      "Could not identify exactly one newly uploaded Worker version.",
    );
  }
  newVersion = uploaded[0].id;
  evidence.newVersion = newVersion;
  const previewUrl = resolveWorkerPreviewUrl({
    uploadOutput,
    alias,
    workerName,
    accountSubdomain: workersDevAccountSubdomain,
  });
  evidence.previewUrl = previewUrl;
  evidence.steps.push({ name: "version_upload", ok: true, previewUrl });

  const previewProbe = await retryWorkerAssetProbe({
    origin: previewUrl,
    versionId: newVersion,
  });
  evidence.steps.push({ name: "preview_probe", ok: true, ...previewProbe });

  run(
    "npx",
    [
      "wrangler",
      "versions",
      "deploy",
      `${previousVersion}@100`,
      `${newVersion}@0`,
      "--message",
      `Stage ${sha} for production override smoke testing`,
      "--yes",
    ],
    apiRoot,
  );
  deploymentChanged = true;
  evidence.steps.push({ name: "zero_percent_stage", ok: true });

  const overrideProbe = await retryWorkerAssetProbe({
    origin: productionOrigin,
    versionId: newVersion,
    requireAffinity: true,
  });
  evidence.steps.push({
    name: "production_version_override_probe",
    ok: true,
    ...overrideProbe,
  });

  run(
    "npx",
    [
      "wrangler",
      "versions",
      "deploy",
      `${newVersion}@100`,
      "--message",
      `Promote verified release ${sha}`,
      "--yes",
    ],
    apiRoot,
  );
  evidence.steps.push({ name: "promotion", ok: true });
  const promotedAt = Date.now();

  const initialProductionProbe = await retryWorkerAssetProbe({
    origin: productionOrigin,
    versionId: newVersion,
    requireAffinity: true,
  });
  process.stdout.write(
    `Asset probe +0s: ${initialProductionProbe.shells} shells and ${initialProductionProbe.bundles} entry bundles passed.\n`,
  );
  const productionProbes = [
    {
      offsetSeconds: 0,
      checkedAt: new Date().toISOString(),
      ...initialProductionProbe,
    },
    ...(await pollWorkerAssetShells({
      origin: productionOrigin,
      versionId: newVersion,
      requireAffinity: true,
      offsetsSeconds: [120, 300, 600],
      startedAt: promotedAt,
    })),
  ];
  evidence.steps.push({
    name: "post_promotion_probes",
    ok: true,
    probes: productionProbes,
  });
  evidence.completedAt = new Date().toISOString();
  evidence.ok = true;
  await saveEvidence(evidence.gitSha, evidence);
  process.stdout.write(
    `Release ${evidence.gitSha} promoted as Worker ${newVersion}.\n`,
  );
} catch (error) {
  evidence.ok = false;
  evidence.failedAt = new Date().toISOString();
  evidence.error = error instanceof Error ? error.message : String(error);
  if (deploymentChanged && previousVersion) {
    try {
      run(
        "npx",
        [
          "wrangler",
          "rollback",
          previousVersion,
          "--message",
          `Automatic rollback after failed release ${evidence.gitSha ?? "unknown"}`,
          "--yes",
        ],
        apiRoot,
        false,
        true,
      );
      evidence.rollback = { ok: true, versionId: previousVersion };
    } catch (rollbackError) {
      evidence.rollback = {
        ok: false,
        versionId: previousVersion,
        error:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      };
    }
  }
  await saveEvidence(evidence.gitSha ?? "failed-release", evidence);
  throw error;
}

function git(argumentsList) {
  return run("git", argumentsList, workspaceRoot, true);
}

function wranglerJson(argumentsList) {
  const output = run("npx", ["wrangler", ...argumentsList], apiRoot, true);
  const firstObject = [output.indexOf("{"), output.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstObject === undefined) throw new Error("Wrangler returned no JSON.");
  return JSON.parse(output.slice(firstObject));
}

function run(
  command,
  argumentsList,
  cwd,
  capture = false,
  nonInteractive = false,
) {
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    env: nonInteractive ? { ...process.env, CI: "true" } : process.env,
    stdio: capture
      ? "pipe"
      : nonInteractive
        ? ["ignore", "inherit", "inherit"]
        : "inherit",
  });
  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${argumentsList.join(" ")} failed with status ${String(result.status)}.`,
    );
  }
  return result.stdout ?? "";
}

async function saveEvidence(sha, value) {
  const directory = path.join(apiRoot, ".wrangler", "release-evidence");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${sha}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}
