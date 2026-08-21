export async function readResponseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  if (
    !(response.headers.get("content-type") ?? "").includes("application/json")
  )
    return fallback;
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("error" in body))
      return fallback;
    const error = body.error;
    if (
      !error ||
      typeof error !== "object" ||
      !("message" in error) ||
      typeof error.message !== "string"
    ) {
      return fallback;
    }
    return error.message.trim() || fallback;
  } catch {
    return fallback;
  }
}
