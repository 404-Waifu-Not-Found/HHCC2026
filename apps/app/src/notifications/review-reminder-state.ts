type AsyncAction = () => Promise<void>;

export async function commitReviewReminderEnable(input: {
  register: AsyncAction;
  persist: AsyncAction;
  rollbackRegistration: AsyncAction;
}): Promise<void> {
  await input.register();
  try {
    await input.persist();
  } catch (error) {
    await input.rollbackRegistration().catch(() => undefined);
    throw error;
  }
}

export async function commitReviewReminderDisable(input: {
  unregister: AsyncAction;
  clear: AsyncAction;
}): Promise<void> {
  await input.unregister();
  await input.clear();
}
