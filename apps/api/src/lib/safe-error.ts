const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function safeErrorName(error: unknown): string {
  try {
    if (error instanceof Error && SAFE_ERROR_NAME.test(error.name)) {
      return error.name;
    }
  } catch {
    // An arbitrary thrown value may expose hostile accessors. Keep logs bounded.
  }
  return "UnknownError";
}
