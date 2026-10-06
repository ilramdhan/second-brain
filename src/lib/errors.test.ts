import { describe, expect, it, vi } from "vitest";

const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

import { errorKey, errorMessage, isConfigError, toastError } from "@/lib/errors";

const pg = (code: string, message = "raw db text") => ({
  name: "PostgrestError",
  code,
  message,
  details: null,
  hint: null,
});

describe("errorMessage", () => {
  it("maps Postgres/PostgREST codes to friendly messages, never raw text", () => {
    expect(
      errorMessage(pg("42501", 'new row violates row-level security policy for table "tasks"')),
    ).toBe("Anda tidak punya akses untuk melakukan ini.");
    expect(errorMessage(pg("23505"))).toBe("Data ini sudah ada.");
    expect(errorMessage(pg("PGRST116"))).toBe("Data tidak ditemukan.");
    expect(errorMessage(pg("XX000"), "Gagal menyimpan")).toBe("Gagal menyimpan");
  });

  it("maps trigger exceptions from the ownership rules", () => {
    expect(
      errorMessage(
        pg("P0001", "only the owner or the project owner can trash or restore this tasks row"),
      ),
    ).toBe("Hanya pembuat atau pemilik proyek yang bisa melakukan ini.");
  });

  it("maps network, session, AI and config errors", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/Tidak dapat terhubung/);
    expect(errorMessage(new Error("Unauthorized: Invalid token"))).toMatch(/Sesi Anda berakhir/);
    expect(
      errorMessage(
        new Error("AI belum dikonfigurasi. Admin perlu mengisi AI_API_KEY (lihat .env.example)."),
      ),
    ).toMatch(/AI belum dikonfigurasi/);
    expect(
      errorMessage(new Error("Missing Supabase environment variable(s): SUPABASE_URL.")),
    ).toMatch(/belum dikonfigurasi dengan benar/);
    expect(errorMessage(new Response(null, { status: 429 }))).toMatch(/Batas penggunaan AI/);
  });

  it("keeps the rate limiter's specific message", () => {
    const msg = "Batas penggunaan AI tercapai (10 permintaan per 1 jam). Coba lagi sebentar lagi.";
    expect(errorMessage(new Error(msg))).toBe(msg);
  });

  it("maps Supabase auth errors", () => {
    expect(
      errorMessage({
        name: "AuthApiError",
        code: "invalid_credentials",
        message: "Invalid login credentials",
      }),
    ).toBe("Email atau kata sandi salah.");
    expect(errorMessage({ name: "AuthRetryableFetchError", message: "{}" })).toMatch(
      /Tidak dapat terhubung/,
    );
  });

  it("passes app-authored messages through and hides technical ones", () => {
    expect(errorMessage(new Error("Tugas harus memiliki tanggal mulai atau tenggat."))).toBe(
      "Tugas harus memiliki tanggal mulai atau tenggat.",
    );
    expect(
      errorMessage(new Error("Cannot read properties of undefined (reading 'x')"), "Gagal"),
    ).toBe("Gagal");
    expect(errorMessage(undefined)).toBe("Terjadi kesalahan. Coba lagi.");
    expect(errorKey("random")).toBeUndefined();
  });

  it("follows the active locale", () => {
    document.documentElement.lang = "en";
    try {
      expect(errorMessage(pg("23505"))).toBe("This already exists.");
    } finally {
      document.documentElement.lang = "id";
    }
  });
});

describe("toastError / isConfigError", () => {
  it("shows the friendly message as an error toast", () => {
    expect(toastError(pg("23505"), undefined, { id: "x" })).toBe("Data ini sudah ada.");
    expect(toastErrorMock).toHaveBeenCalledWith("Data ini sudah ada.", { id: "x" });
  });

  it("detects the missing Supabase env error", () => {
    expect(isConfigError(new Error("Missing Supabase environment variable(s): SUPABASE_URL"))).toBe(
      true,
    );
    expect(isConfigError(new Error("other"))).toBe(false);
  });
});

describe("demo messages", () => {
  it("shows demo guard and demo limit messages as-is", () => {
    expect(errorMessage(new Error("Tidak tersedia di demo: Telegram."))).toBe(
      "Tidak tersedia di demo: Telegram.",
    );
    // Raised by the demo database triggers (P0001) and wrapped in a PostgREST error.
    expect(errorMessage(pg("P0001", "Batas demo: maksimal 300 tugas."))).toBe(
      "Batas demo: maksimal 300 tugas.",
    );
    // Not swallowed by the generic rate-limit mapping either.
    expect(
      errorMessage(new Error("Batas demo: terlalu banyak permintaan. Coba lagi sebentar lagi.")),
    ).toMatch(/^Batas demo: terlalu banyak/);
    expect(errorKey(pg("P0001", "Batas demo: kuota tulis habis"))).toBeUndefined();
  });
});
