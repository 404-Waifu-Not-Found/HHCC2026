export function createId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

