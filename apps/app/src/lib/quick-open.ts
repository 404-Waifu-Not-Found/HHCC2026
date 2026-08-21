import { identifyVideoSource } from "@clipquest/contracts";

export type QuickOpenSearchParams = {
  url?: string | string[];
  autostart?: string | string[];
};

export type QuickOpenRequest = {
  url: string;
  autostart: "1";
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseQuickOpenRequest(
  params: QuickOpenSearchParams,
): QuickOpenRequest | null {
  const url = first(params.url)?.trim();
  const autostart = first(params.autostart);
  if (autostart !== "1" || !url || !identifyVideoSource(url)) return null;
  return { url, autostart: "1" };
}
