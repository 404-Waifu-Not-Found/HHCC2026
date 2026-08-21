export function hasConfirmedMinimumAge(user: Record<string, unknown>): boolean {
  return user.ageConfirmed === true;
}
