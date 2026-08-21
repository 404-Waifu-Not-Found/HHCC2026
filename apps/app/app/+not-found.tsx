import { VoxelIcon } from "../src/components/VoxelIcon";
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
        icon="help"
        title={t("notFoundTitle")}
        description={t("notFoundBody")}
        action={
          <PrimaryButton
            leadingIcon={
              <VoxelIcon name="home" size={20} color={theme.textOnAction} />
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
