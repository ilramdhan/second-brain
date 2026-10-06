import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./axe";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("landing page renders without serious a11y violations", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: /masuk/i }).first()).toBeVisible();
      await expectNoSeriousA11yViolations(page, `/ (${scheme})`);
    });

    test("login page renders without serious a11y violations", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(page.getByLabel("Kata sandi")).toBeVisible();
      await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
      await expectNoSeriousA11yViolations(page, `/login (${scheme})`);
    });
  });
}

test("authenticated routes redirect guests to /login", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login/);
});
