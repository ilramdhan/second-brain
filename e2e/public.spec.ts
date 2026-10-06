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

    for (const path of ["/privacy", "/terms"]) {
      test(`${path} renders without serious a11y violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByText(/bukan nasihat hukum/)).toBeVisible();
        await expectNoSeriousA11yViolations(page, `${path} (${scheme})`);
      });
    }
  });
}

test("authenticated routes redirect guests to /login", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login/);
});

test("login links back to the landing page and hides sign-up by default", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Daftar/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Kembali ke beranda/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("landing header is sticky and its menu scrolls to sections", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const menu = header.getByRole("navigation", { name: "Menu utama" });
  await menu.getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/#faq$/);
  await expect(page.locator("#faq")).toBeInViewport();
  await expect(header).toBeInViewport();
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: "Privasi", exact: true }),
  ).toHaveAttribute("href", "/privacy");
});

test("mobile menu opens a sheet with the section links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Buka menu" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("link", { name: "Self-host" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#self-host")).toBeInViewport();
});
