import { describe, expect, it } from "vitest";

import {
  invitedProjectPath,
  jwtSubject,
  normalizeEmail,
  parseAuthLinkParams,
  passwordStrength,
} from "./password";

describe("passwordStrength", () => {
  it("scores length and variety", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").score).toBe(1);
    expect(passwordStrength("abc").acceptable).toBe(false);
    expect(passwordStrength("abcdefgh").score).toBe(2);
    expect(passwordStrength("abcdefg1!").score).toBe(3);
    expect(passwordStrength("Abcdefg1!").score).toBe(4);
    expect(passwordStrength("abcdefghijklmn").score).toBe(3);
    expect(passwordStrength("abcdefgh").acceptable).toBe(true);
    expect(passwordStrength("a".repeat(73)).acceptable).toBe(false);
  });
});

describe("parseAuthLinkParams", () => {
  it("reads implicit invite links from the hash", () => {
    const link = parseAuthLinkParams("https://a.test/auth/set-password#access_token=t&type=invite");
    expect(link).toMatchObject({ kind: "invite", hasTokens: true, code: null, error: null });
  });

  it("reads PKCE links from the query", () => {
    expect(parseAuthLinkParams("https://a.test/x?code=c1&type=recovery")).toMatchObject({
      kind: "recovery",
      code: "c1",
    });
  });

  it("reports Supabase errors such as an expired link", () => {
    const link = parseAuthLinkParams(
      "https://a.test/x#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
    );
    expect(link.error).toEqual({ code: "otp_expired", description: "Email link is invalid" });
  });
});

describe("helpers", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail(" A@B.co ")).toBe("a@b.co");
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(320)}@b.co`)).toBeNull();
  });

  it("only builds project paths from uuids", () => {
    const id = "5b1f6a2e-3c4d-4e8f-9a0b-1c2d3e4f5a6b";
    expect(invitedProjectPath({ invited_project_id: id })).toBe(`/projects/${id}`);
    expect(invitedProjectPath({ invited_project_id: "../../evil" })).toBeNull();
    expect(invitedProjectPath(null)).toBeNull();
  });

  it("reads the JWT subject", () => {
    expect(jwtSubject(`x.${btoa(JSON.stringify({ sub: "u1" }))}.y`)).toBe("u1");
    expect(jwtSubject("garbage")).toBeNull();
    expect(jwtSubject(null)).toBeNull();
  });
});
