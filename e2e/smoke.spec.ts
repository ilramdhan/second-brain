import { expect, test } from "@playwright/test";

/**
 * Authenticated smoke test: login → create a task → create a note, cleaning up afterwards
 * (both go to the trash, which the app purges after 30 days).
 *
 * Needs a real deployment with a dedicated test account, so it only runs when E2E_EMAIL and
 * E2E_PASSWORD are set (and normally E2E_BASE_URL, e.g. a Vercel preview). Never point it at an
 * account with real data.
 */
const email = process.env["E2E_EMAIL"];
const password = process.env["E2E_PASSWORD"];

test.describe("authenticated smoke", () => {
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");
  test.describe.configure({ mode: "serial" });

  test("login → create task → create note", async ({ page }) => {
    const stamp = `e2e ${Date.now()}`;
    page.on("dialog", (d) => void d.accept());

    await test.step("login", async () => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email!);
      await page.getByLabel("Kata sandi").fill(password!);
      await page.getByRole("button", { name: "Masuk", exact: true }).click();
      await expect(page).toHaveURL(/\/today/, { timeout: 20_000 });
    });

    await test.step("create task with quick add", async () => {
      await page.goto("/tasks");
      await expect(page.getByRole("heading", { name: "Tugas", level: 1 })).toBeVisible();
      await page.locator("body").press("q");
      const dialog = page.getByRole("dialog", { name: "Tugas cepat" });
      await dialog.getByLabel("Tugas cepat").fill(`Tugas ${stamp}`);
      await dialog.getByRole("button", { name: "Buat" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(`Tugas ${stamp}`).first()).toBeVisible();
    });

    await test.step("create note", async () => {
      await page.goto("/notes");
      await page.getByRole("button", { name: "Catatan", exact: true }).click();
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/);
      const title = page.getByLabel("Judul catatan");
      await title.fill(`Catatan ${stamp}`);
      // Saves are debounced; wait for the title to persist before navigating away.
      await page.waitForTimeout(1_500);
      await page.goto("/notes");
      await expect(page.getByText(`Catatan ${stamp}`).first()).toBeVisible();
    });

    await test.step("clean up", async () => {
      await page.getByText(`Catatan ${stamp}`).first().click();
      await page.getByRole("button", { name: "Hapus catatan" }).click();
      await page.goto("/tasks");
      await page.getByText(`Tugas ${stamp}`).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Hapus" }).click();
    });
  });
});
