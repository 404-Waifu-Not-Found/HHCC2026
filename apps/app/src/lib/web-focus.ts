export function blurActiveWebElement(): void {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined")
    return;
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
}
