const FINGERPRINT_PATTERN = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;

export function androidAssetLinks(rawFingerprint: string | undefined):
  | {
      relation: ["delegate_permission/common.handle_all_urls"];
      target: {
        namespace: "android_app";
        package_name: "cc.ccwu.clipquest";
        sha256_cert_fingerprints: [string];
      };
    }[]
  | null {
  const fingerprint = rawFingerprint?.trim().toUpperCase();
  if (!fingerprint || !FINGERPRINT_PATTERN.test(fingerprint)) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "cc.ccwu.clipquest",
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ];
}
