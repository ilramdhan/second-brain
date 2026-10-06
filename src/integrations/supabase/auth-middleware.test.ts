import { describe, expect, it, vi } from "vitest";

import { mfaSatisfied } from "@/integrations/supabase/auth-middleware";

const db = (result: {
  data: boolean | null;
  error: { code?: string; message?: string } | null;
}) => ({
  rpc: vi.fn().mockResolvedValue(result),
});

describe("mfaSatisfied (server aal2 guard)", () => {
  it("lets aal2 tokens through without a database call", async () => {
    const client = db({ data: false, error: null });
    await expect(mfaSatisfied({ aal: "aal2" }, client)).resolves.toBe(true);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("asks the database for aal1 tokens", async () => {
    const without = db({ data: true, error: null });
    await expect(mfaSatisfied({ aal: "aal1" }, without)).resolves.toBe(true);
    expect(without.rpc).toHaveBeenCalledWith("mfa_satisfied");
    await expect(mfaSatisfied({ aal: "aal1" }, db({ data: false, error: null }))).resolves.toBe(
      false,
    );
  });

  it("fails closed when the check errors", async () => {
    await expect(mfaSatisfied({}, db({ data: null, error: { message: "boom" } }))).resolves.toBe(
      false,
    );
  });

  it("does not lock everyone out before migration 0021 is applied", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      mfaSatisfied({ aal: "aal1" }, db({ data: null, error: { code: "PGRST202" } })),
    ).resolves.toBe(true);
  });
});
