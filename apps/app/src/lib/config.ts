import Constants from "expo-constants";

type ExtraConfig = {
  apiOrigin?: string;
  eas?: { projectId?: string };
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

export const API_ORIGIN = (
  extra.apiOrigin ?? "https://clipquest.ccwu.cc"
).replace(/\/$/, "");
export const EAS_PROJECT_ID = extra.eas?.projectId;
