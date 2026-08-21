import type { AppLanguage } from "@clipquest/contracts";

export async function reviewRemindersEnabled(
  _userId: string,
): Promise<boolean> {
  return false;
}

export async function enableReviewReminders(
  _userId: string,
  _locale: AppLanguage,
): Promise<void> {
  throw new Error("Review reminders are available in the Android app.");
}

export async function disableReviewReminders(_userId: string): Promise<void> {}

export async function clearReviewReminderDeviceState(
  _userId: string,
): Promise<void> {}
