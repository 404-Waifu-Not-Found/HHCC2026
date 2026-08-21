import { extractAssetReferences } from "../../app/scripts/verify-web-assets.mjs";

export const productionShellPaths = [
  "/",
  "/library",
  "/settings",
  "/admin",
  "/admin/jobs",
  "/admin/system",
  "/create/00000000-0000-4000-8000-000000000001",
  "/generation/00000000-0000-4000-8000-000000000001",
  "/quiz/00000000-0000-4000-8000-000000000001",
];

export async function probeWorkerAssetShells({
  origin,
  versionId,
  requireAffinity = false,
  paths = productionShellPaths,
}) {
  const base = new URL(origin);
  const headers = requestHeaders(versionId);
  const health = await fetchChecked(new URL("/health", base), headers);
  const healthBody = await health.json();
  if (versionId && healthBody?.worker?.versionId !== versionId) {
    throw new Error(
      `Health check reached Worker ${String(healthBody?.worker?.versionId)} instead of ${versionId}.`,
    );
  }
  if (
    requireAffinity &&
    healthBody?.versionAffinity?.requestKeyPresent !== true
  ) {
    throw new Error(
      "The Cloudflare-Workers-Version-Key transform rule was not observed by /health.",
    );
  }

  let checkedBundles = 0;
  for (const shellPath of paths) {
    const shellUrl = cacheBustedUrl(new URL(shellPath, base));
    const response = await fetchChecked(shellUrl, headers);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error(
        `${shellPath} returned ${contentType || "no content type"}.`,
      );
    }
    if (!(response.headers.get("cache-control") ?? "").includes("no-store")) {
      throw new Error(`${shellPath} did not return Cache-Control: no-store.`);
    }
    if (
      versionId &&
      response.headers.get("x-clipquest-worker-version") !== versionId
    ) {
      throw new Error(
        `${shellPath} did not identify the expected Worker version ${versionId}.`,
      );
    }

    const source = await response.text();
    const bundles = extractAssetReferences(source)
      .filter(
        (reference) =>
          reference.kind === "script" ||
          reference.kind.includes("modulepreload"),
      )
      .map((reference) => new URL(reference.value, shellUrl))
      .filter(
        (assetUrl) =>
          assetUrl.origin === base.origin &&
          /(?:^|\/)_[Ee][Xx][Pp][Oo]\/static\/js\//u.test(assetUrl.pathname),
      );
    if (bundles.length === 0) {
      throw new Error(`${shellPath} did not reference an Expo entry bundle.`);
    }
    for (const bundleUrl of bundles) {
      const bundleResponse = await fetchChecked(
        cacheBustedUrl(bundleUrl),
        headers,
      );
      const bundleType = bundleResponse.headers.get("content-type") ?? "";
      if (!/(?:java|ecma)script/iu.test(bundleType)) {
        throw new Error(
          `${bundleUrl.pathname} returned ${bundleType || "no content type"}.`,
        );
      }
      checkedBundles += 1;
      await bundleResponse.body?.cancel();
    }
  }
  return {
    workerVersion: healthBody.worker,
    shells: paths.length,
    bundles: checkedBundles,
    versionAffinityPresent:
      healthBody?.versionAffinity?.requestKeyPresent === true,
  };
}

export async function pollWorkerAssetShells({
  origin,
  versionId,
  requireAffinity,
  offsetsSeconds,
}) {
  const startedAt = Date.now();
  const results = [];
  for (const offsetSeconds of offsetsSeconds) {
    await waitUntil(startedAt + offsetSeconds * 1_000);
    const result = await probeWorkerAssetShells({
      origin,
      versionId,
      requireAffinity,
    });
    results.push({
      offsetSeconds,
      checkedAt: new Date().toISOString(),
      ...result,
    });
    process.stdout.write(
      `Asset probe +${offsetSeconds}s: ${result.shells} shells and ${result.bundles} entry bundles passed.\n`,
    );
  }
  return results;
}

function requestHeaders(versionId) {
  const headers = new Headers({
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "Cache-Control": "no-cache",
  });
  if (versionId) {
    headers.set(
      "Cloudflare-Workers-Version-Overrides",
      `clipquest="${versionId}"`,
    );
  }
  return headers;
}

async function fetchChecked(url, headers) {
  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  }
  return response;
}

function cacheBustedUrl(url) {
  const next = new URL(url);
  next.searchParams.set("clipquest_asset_probe", String(Date.now()));
  return next;
}

async function waitUntil(targetTime) {
  while (Date.now() < targetTime) {
    const remaining = targetTime - Date.now();
    const waitMs = Math.min(30_000, remaining);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (remaining > 30_000) {
      process.stdout.write(
        `Waiting for next production asset probe (${Math.ceil((targetTime - Date.now()) / 1_000)}s remaining).\n`,
      );
    }
  }
}

if (process.argv[1]?.endsWith("probe-worker-assets.mjs")) {
  const options = parseArguments(process.argv.slice(2));
  const results = await pollWorkerAssetShells(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    values.set(argumentsList[index], argumentsList[index + 1]);
  }
  const origin = values.get("--origin");
  if (!origin) throw new Error("--origin is required.");
  const offsetsSeconds = (values.get("--offsets") ?? "0")
    .split(",")
    .map(Number);
  if (offsetsSeconds.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("--offsets must contain non-negative seconds.");
  }
  return {
    origin,
    versionId: values.get("--version"),
    requireAffinity: values.get("--require-affinity") === "true",
    offsetsSeconds,
  };
}
