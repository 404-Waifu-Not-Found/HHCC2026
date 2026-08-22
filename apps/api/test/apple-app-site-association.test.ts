import { describe, expect, it } from "vitest";
import { appleAppSiteAssociation } from "../src/lib/apple-app-site-association";

describe("iOS Universal Links association", () => {
  it("publishes only a valid Apple development team identifier", () => {
    const association = appleAppSiteAssociation("ab12cd34ef");
    expect(association?.applinks.details[0]).toEqual({
      appID: "AB12CD34EF.cc.ccwu.clipquest",
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
    });
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("debug-team")).toBeNull();
  });
});
