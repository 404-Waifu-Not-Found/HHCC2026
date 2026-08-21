const workersDevLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function resolveWorkerPreviewUrl({
  uploadOutput,
  alias,
  workerName,
  accountSubdomain,
}) {
  const reportedUrl = uploadOutput.match(
    /https:\/\/[^\s]+\.workers\.dev/iu,
  )?.[0];
  if (reportedUrl) return reportedUrl.replace(/[),.;]+$/u, "");

  for (const [label, value] of Object.entries({
    alias,
    workerName,
    accountSubdomain,
  })) {
    if (!workersDevLabelPattern.test(value)) {
      throw new Error(`Invalid ${label} for a Worker preview URL.`);
    }
  }

  return `https://${alias}-${workerName}.${accountSubdomain}.workers.dev`;
}
