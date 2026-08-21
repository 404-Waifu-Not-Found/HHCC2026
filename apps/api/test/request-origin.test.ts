import { describe, expect, it } from "vitest";
import {
  authTrustedOrigins,
  isAllowedRequestOrigin,
} from "../src/lib/request-origin";

const production = {
  APP_ORIGIN: "https://clipquest.ccwu.cc",
  BETTER_AUTH_URL: "https://clipquest.ccwu.cc",
};

const development = {
  APP_ORIGIN: "http://localhost:8081",
  BETTER_AUTH_URL: "http://localhost:8787",
};

describe("request origin policy", () => {
  it("does not trust loopback browser origins in production", () => {
    expect(isAllowedRequestOrigin(undefined, production)).toBe(true);
    expect(
      isAllowedRequestOrigin("https://clipquest.ccwu.cc", production),
    ).toBe(true);
    expect(isAllowedRequestOrigin("clipquest://", production)).toBe(true);
    expect(isAllowedRequestOrigin("clipquest://attacker", production)).toBe(
      false,
    );
    expect(isAllowedRequestOrigin("http://localhost:8081", production)).toBe(
      false,
    );
    expect(isAllowedRequestOrigin("http://127.0.0.1:19006", production)).toBe(
      false,
    );

    expect(authTrustedOrigins(production)).toEqual([
      "https://clipquest.ccwu.cc",
      "clipquest://",
      "clipquest://*",
    ]);
  });

  it("enables bounded loopback origins only for an explicit local setup", () => {
    expect(isAllowedRequestOrigin("http://localhost:8081", development)).toBe(
      true,
    );
    expect(isAllowedRequestOrigin("http://127.0.0.1:8787", development)).toBe(
      true,
    );
    expect(isAllowedRequestOrigin("http://localhost:3000", development)).toBe(
      false,
    );
    expect(authTrustedOrigins(development)).toContain("http://localhost:19006");
  });

  it("matches the configured web origin without trusting lookalikes", () => {
    expect(
      isAllowedRequestOrigin("https://clipquest.ccwu.cc", {
        ...production,
        APP_ORIGIN: "https://clipquest.ccwu.cc/",
      }),
    ).toBe(true);
    expect(
      isAllowedRequestOrigin(
        "https://clipquest.ccwu.cc.attacker.example",
        production,
      ),
    ).toBe(false);
    expect(isAllowedRequestOrigin("not a URL", production)).toBe(false);
  });
});
