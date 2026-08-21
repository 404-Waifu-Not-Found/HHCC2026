(() => {
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  let mode = "system";

  try {
    const stored = JSON.parse(
      globalThis.localStorage.getItem("clipquest:settings:v1") || "{}",
    );
    if (stored.themeMode === "light" || stored.themeMode === "dark") {
      mode = stored.themeMode;
    }
  } catch {
    // Invalid or unavailable storage should fall back to the OS preference.
  }

  const dark =
    mode === "dark" ||
    (mode === "system" &&
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolvedTheme = dark ? "dark" : "light";
  const background = dark ? "#101B15" : "#F7F9F4";
  const chromeColor = dark ? "#16231B" : "#247D49";

  root.dataset.cqTheme = resolvedTheme;
  root.dataset.cqDevice =
    globalThis.innerWidth >= 1024
      ? "desktop"
      : globalThis.innerWidth >= 768
        ? "tablet"
        : "mobile";
  root.style.colorScheme = resolvedTheme;
  root.style.backgroundColor = background;
  themeMeta?.setAttribute("content", chromeColor);
})();
