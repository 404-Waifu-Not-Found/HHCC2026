import { describe, expect, it } from "vitest";
import { lightTheme, darkTheme, type AppTheme } from "../src/theme/tokens";

/**
 * WCAG 2.1 contrast-ratio check for the color pairs actually used by the
 * Workplace tab (thread rail, message bubbles, composer, citations, tool
 * visualizations, practice set, offline banner, privacy notice). This keeps
 * the "light/dark theme parity" and "WCAG AA contrast" polish requirements
 * enforced by a real, running test rather than a one-off manual audit -
 * any future token change that regresses contrast for these pairs will fail
 * this test.
 */

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace("#", "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(value, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const rLin = srgbChannelToLinear(r);
  const gLin = srgbChannelToLinear(g);
  const bLin = srgbChannelToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA thresholds: 4.5:1 for normal text, 3:1 for large-scale/UI text.
const AA_NORMAL_TEXT = 4.5;

describe("Workplace theme contrast (WCAG AA)", () => {
  const cases: Array<{
    label: string;
    fg: (t: AppTheme) => string;
    bg: (t: AppTheme) => string;
  }> = [
    {
      label: "primary text on background (message text, thread titles)",
      fg: (t) => t.text,
      bg: (t) => t.background,
    },
    {
      label: "primary text on surface (composer, cards)",
      fg: (t) => t.text,
      bg: (t) => t.surface,
    },
    {
      label: "muted text on background (thread previews, timestamps)",
      fg: (t) => t.textMuted,
      bg: (t) => t.background,
    },
    {
      label: "muted text on surface (thread previews, timestamps)",
      fg: (t) => t.textMuted,
      bg: (t) => t.surface,
    },
    {
      label: "muted text on tinted surface (privacy notice, suggestion pills)",
      fg: (t) => t.textMuted,
      bg: (t) => t.surfaceTint,
    },
    {
      label: "text-on-primary on primary (user bubble, unread badge)",
      fg: (t) => t.textOnPrimary,
      bg: (t) => t.primary,
    },
    {
      label: "primary on primary-soft (suggestion pill label, citation accent)",
      fg: (t) => t.primary,
      bg: (t) => t.primarySoft,
    },
    {
      label: "error text on surface (send/tool error messages)",
      fg: (t) => t.error,
      bg: (t) => t.surface,
    },
    {
      label: "error text on background (send/tool error messages)",
      fg: (t) => t.error,
      bg: (t) => t.background,
    },
    {
      label: "success text on surface (practice set saved indicator)",
      fg: (t) => t.success,
      bg: (t) => t.surface,
    },
    {
      label: "warning text on warning-soft (offline banner body)",
      fg: (t) => t.warningText,
      bg: (t) => t.warningSoft,
    },
    {
      label: "primary text on warning-soft (offline banner title)",
      fg: (t) => t.text,
      bg: (t) => t.warningSoft,
    },
  ];

  const themes: Array<{ name: string; theme: AppTheme }> = [
    { name: "light", theme: lightTheme },
    { name: "dark", theme: darkTheme },
  ];

  for (const { name, theme } of themes) {
    for (const { label, fg, bg } of cases) {
      it(`${name} theme: ${label} meets WCAG AA (>= ${AA_NORMAL_TEXT}:1)`, () => {
        const ratio = contrastRatio(fg(theme), bg(theme));
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});
