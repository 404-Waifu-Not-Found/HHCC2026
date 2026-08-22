const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export function appleAppSiteAssociation(rawTeamId: string | undefined): {
  applinks: {
    apps: [];
    details: { appID: string; paths: string[] }[];
  };
} | null {
  const teamId = rawTeamId?.trim().toUpperCase();
  if (!teamId || !TEAM_ID_PATTERN.test(teamId)) return null;
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.cc.ccwu.clipquest`,
          paths: [
            "/reset-password",
            "/reset-password/*",
            "/verify-email",
            "/verify-email/*",
            "/library",
            "/library/*",
            "/quiz/*",
            "/s/*",
          ],
        },
      ],
    },
  };
}
