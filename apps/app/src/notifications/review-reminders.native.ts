import {
  PushRegisterResponseSchema,
  PushUnregisterResponseSchema,
  type AppLanguage,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest, jsonBody } from "../lib/api";
import {
  commitReviewReminderDisable,
  commitReviewReminderEnable,
} from "./review-reminder-state";

const ENABLED_PREFIX = "clipquest:review-reminders:v1:";
const TOKEN_PREFIX = "clipquest:review-push-token:v1:";

export async function reviewRemindersEnabled(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(`${ENABLED_PREFIX}${userId}`)) === "1";
}

export async function enableReviewReminders(
  userId: string,
  locale: AppLanguage,
): Promise<void> {
  if (!Device.isDevice) {
    throw new Error("Review reminders require a physical device.");
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("This beta is missing its EAS project configuration.");
  }
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("study-reviews", {
      name: "Study reviews",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await commitReviewReminderEnable({
    register: async () => {
      await apiRequest(
        "/api/push/register",
        {
          method: "POST",
          body: jsonBody({
            token,
            platform: Platform.OS === "ios" ? "ios" : "android",
            locale,
          }),
        },
        PushRegisterResponseSchema,
      );
    },
    persist: () =>
      AsyncStorage.multiSet([
        [`${TOKEN_PREFIX}${userId}`, token],
        [`${ENABLED_PREFIX}${userId}`, "1"],
      ]),
    rollbackRegistration: async () => {
      await apiRequest(
        "/api/push/register",
        { method: "DELETE", body: jsonBody({ token }) },
        PushUnregisterResponseSchema,
      );
    },
  });
}

export async function disableReviewReminders(userId: string): Promise<void> {
  const token = await AsyncStorage.getItem(`${TOKEN_PREFIX}${userId}`);
  await commitReviewReminderDisable({
    unregister: async () => {
      if (!token) return;
      await apiRequest(
        "/api/push/register",
        { method: "DELETE", body: jsonBody({ token }) },
        PushUnregisterResponseSchema,
      );
    },
    clear: () =>
      AsyncStorage.multiRemove([
        `${TOKEN_PREFIX}${userId}`,
        `${ENABLED_PREFIX}${userId}`,
      ]),
  });
}

export async function clearReviewReminderDeviceState(
  userId: string,
): Promise<void> {
  await AsyncStorage.multiRemove([
    `${TOKEN_PREFIX}${userId}`,
    `${ENABLED_PREFIX}${userId}`,
  ]);
}
