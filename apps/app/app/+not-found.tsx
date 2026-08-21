import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { EmptyState } from "../src/components/EmptyState";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { Screen } from "../src/components/Screen";
import { useSettings } from "../src/providers/SettingsProvider";

export default function NotFoundScreen() {
  const { t, theme } = useSettings();
  return (
    <Screen contentWidth="reading" centered>
      <EmptyState
        icon="map-marker-question-outline"
        title={t("notFoundTitle")}
        description={t("notFoundBody")}
        action={
          <PrimaryButton
            leadingIcon={
              <MaterialCommunityIcons
                name="home-variant"
                size={20}
                color={theme.textOnAction}
              />
            }
            onPress={() => router.replace("/")}
          >
            {t("home")}
          </PrimaryButton>
        }
      />
    </Screen>
  );
}
