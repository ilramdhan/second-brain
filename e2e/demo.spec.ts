import { expect, test } from "@playwright/test";

/**
 * Smoke test for the public demo deployment (docs/DEMO.md): demo login, banner, noindex and the
 * seeded data on the main pages. Read-only: it changes nothing, so it can run against the live
 * demo at any time.
 *
 * Only runs when E2E_DEMO_BASE_URL is set, e.g.
 *   E2E_DEMO_BASE_URL=https://demo-2ndbrain.ilramdhan.dev bunx playwright test e2e/demo.spec.ts
 */
const baseURL = process.env["E2E_DEMO_BASE_URL"]?.replace(/\/$/, "");

test.describe("public demo", () => {
  test.skip(!baseURL, "E2E_DEMO_BASE_URL not set");
  test.describe.configure({ mode: "serial" });
  test.use(baseURL ? { baseURL } : {});

  test("reset endpoint needs credentials", async ({ request }) => {
    const res = await request.post("/api/public/n8n/demo/reset");
    expect(res.status()).toBe(401);
  });

  test("is not indexed", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("demo login → seeded pages", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Masuk sebagai demo" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 20_000 });
    await expect(page.getByText(/Mode demo/)).toBeVisible();

    await page.goto("/projects");
    await expect(page.getByText("Aplikasi Kasir").first()).toBeVisible();

    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tugas", level: 1 })).toBeVisible();
    await expect(page.getByText(/printer Bluetooth/i).first()).toBeVisible();

    await page.goto("/notes");
    await expect(page.getByText("Selamat datang di demo").first()).toBeVisible();

    await page.goto("/inbox");
    await expect(page.getByText(/Meeting sprint aplikasi kasir/).first()).toBeVisible();
  });
});
