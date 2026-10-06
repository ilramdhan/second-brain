import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./axe";

// Public share links (`/s/$token`, Phase 9.5). Without a real backend every token is unknown, which
// is exactly the case to pin down: malformed, unknown, revoked and expired links all render the
// same 404 page, are never indexed, never cached and carry no referrer.

const UNKNOWN = "A".repeat(43); // well-formed, does not exist

for (const token of ["not-a-token", UNKNOWN]) {
  test(`invalid share link ${token.length} chars is a 404 with noindex`, async ({ page }) => {
    const response = await page.goto(`/s/${token}`);
    expect(response?.status()).toBe(404);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tautan tidak tersedia");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.getByRole("link", { name: /Tentang Second Brain/ })).toHaveAttribute(
      "href",
      "/",
    );
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    test("unavailable share page has no serious a11y violations", async ({ page }) => {
      await page.goto(`/s/${UNKNOWN}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoSeriousA11yViolations(page, `/s/<token> (${scheme})`);
    });
  });
}
