import { describe, expect, it } from "vitest";
import { enabledSocialProviders, isSocialProvider, socialCredentials, socialErrorMessage } from "./social";

describe("social sign-in providers", () => {
  it("are on only when both credentials are set, Google first", () => {
    expect(enabledSocialProviders({})).toEqual([]);
    expect(enabledSocialProviders({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "" })).toEqual([]);
    expect(enabledSocialProviders({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b" })).toEqual(["github"]);
    expect(
      enabledSocialProviders({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "d" }),
    ).toEqual(["google", "github"]);
    expect(socialCredentials("google", { GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "d" })).toEqual({ clientId: "c", clientSecret: "d" });
  });

  it("accept only known providers from a form", () => {
    expect(isSocialProvider("google")).toBe(true);
    expect(isSocialProvider("facebook")).toBe(false);
    expect(isSocialProvider(null)).toBe(false);
  });

  it("explain failures naming the service used", () => {
    expect(socialErrorMessage("account_not_linked", "google")).toMatch(/your Google email already exists/);
    expect(socialErrorMessage("access_denied", "github")).toBe("GitHub sign-in was cancelled.");
    expect(socialErrorMessage("something_else", null)).toBe("That sign-in didn't complete. Please try again.");
  });
});
