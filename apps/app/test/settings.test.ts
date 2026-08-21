import { describe, expect, it } from "vitest";
import {
  deviceClassForWidth,
  parseStoredSettings,
  resolveThemeMode,
} from "../src/lib/settings";
import { pickWebFile } from "../src/lib/web-file-picker";

describe("settings preflight", () => {
  it("keeps only supported stored settings", () => {
    expect(
      parseStoredSettings(
        JSON.stringify({
          locale: "en",
          themeMode: "dark",
          reduceMotion: true,
          unknown: "ignored",
        }),
      ),
    ).toEqual({ locale: "en", themeMode: "dark", reduceMotion: true });
    expect(parseStoredSettings("not-json")).toEqual({});
  });

  it("settles without a file when the web picker is canceled", async () => {
    const inputListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const input = {
      files: null,
      addEventListener: (type: string, listener: EventListener) =>
        inputListeners.set(type, listener),
      removeEventListener: (type: string) => inputListeners.delete(type),
      click: () => inputListeners.get("cancel")?.(new Event("cancel")),
    } as unknown as HTMLInputElement;
    const targetWindow = {
      addEventListener: (type: string, listener: EventListener) =>
        windowListeners.set(type, listener),
      removeEventListener: (type: string) => windowListeners.delete(type),
    } as unknown as Window;

    await expect(pickWebFile(input, targetWindow)).resolves.toBeNull();
    expect(inputListeners.size).toBe(0);
    expect(windowListeners.size).toBe(0);
  });

  it("treats window focus as a canceled picker when no file was selected", async () => {
    const windowListeners = new Map<string, EventListener>();
    const input = {
      files: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      click: () => undefined,
    } as unknown as HTMLInputElement;
    const targetWindow = {
      addEventListener: (type: string, listener: EventListener) =>
        windowListeners.set(type, listener),
      removeEventListener: (type: string) => windowListeners.delete(type),
    } as unknown as Window;

    const selection = pickWebFile(input, targetWindow);
    windowListeners.get("focus")?.(new Event("focus"));

    await expect(selection).resolves.toBeNull();
    expect(windowListeners.size).toBe(0);
  });

  it("resolves explicit themes before the system preference", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });

  it("classifies responsive widths before the UI is revealed", () => {
    expect(deviceClassForWidth(390)).toBe("mobile");
    expect(deviceClassForWidth(768)).toBe("tablet");
    expect(deviceClassForWidth(1440)).toBe("desktop");
  });
});
