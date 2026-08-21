export function pickWebFile(
  input: HTMLInputElement,
  targetWindow: Window = window,
): Promise<File | null> {
  return new Promise((resolve) => {
    let focusCheck: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      targetWindow.removeEventListener("focus", onFocus);
      if (focusCheck) clearTimeout(focusCheck);
    };
    const settle = (file: File | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };
    const onChange = () => settle(input.files?.[0] ?? null);
    const onCancel = () => settle(null);
    const onFocus = () => {
      focusCheck = setTimeout(() => settle(input.files?.[0] ?? null), 0);
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    targetWindow.addEventListener("focus", onFocus);
    input.click();
  });
}
