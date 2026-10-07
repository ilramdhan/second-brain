import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/lib/preferences";

import { fillSummary } from "@/lib/capture-fields";

import { FillFromText } from "./FillFromText";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

const labels = { color: "warna", parent: "induk" };

describe("fillSummary", () => {
  it("names who filled which fields and what was ignored", () => {
    expect(
      fillSummary({ via: "ai", filled: ["color", "parent"], dropped: ["x"] }, labels, ["extra"]),
    ).toBe("Diisi AI: warna, induk · Diabaikan: x · extra · Periksa lalu simpan.");
    expect(fillSummary({ via: "regex", filled: [], dropped: [] }, labels)).toBe(
      "Diisi parser lokal · Periksa lalu simpan.",
    );
  });
});

describe("FillFromText", () => {
  it("asks for a draft and hands it to the form without saving", async () => {
    const result = { via: "ai" as const, filled: ["color"], dropped: [], name: "Loyalti" };
    const onFill = vi.fn(async () => result);
    const onApply = vi.fn();
    render(
      <PreferencesProvider>
        <FillFromText
          examples={[]}
          placeholder="teks"
          labels={labels}
          onFill={onFill}
          onApply={onApply}
        />
      </PreferencesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Isi dari teks/ }));
    const button = screen.getByRole("button", { name: /Isi formulir/ });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Teks untuk mengisi formulir"), {
      target: { value: "proyek loyalti warna ungu" },
    });
    fireEvent.click(button);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(result));
    expect(onFill).toHaveBeenCalledWith("proyek loyalti warna ungu");
    expect(screen.getByRole("status")).toHaveTextContent("Diisi AI: warna");
  });
});
