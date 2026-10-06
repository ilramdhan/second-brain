import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOCALE_COOKIE,
  parseLocale,
  parseTheme,
  preferencesFromCookies,
  readCookie,
  readPreferenceCookies,
  THEME_COOKIE,
} from "./preference-cookies";
import { PreferencesProvider, usePreferences, type Locale } from "./preferences";

function clearCookies() {
  for (const name of [LOCALE_COOKIE, THEME_COOKIE]) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

afterEach(() => {
  clearCookies();
  localStorage.clear();
  document.documentElement.lang = "id";
  document.documentElement.className = "";
  vi.restoreAllMocks();
});

describe("preference cookies", () => {
  it("parses a Cookie header and falls back to defaults", () => {
    const header = "a=1; sb_lang=en; sb_theme=dark; other=x%20y";
    expect(readCookie(header, "sb_lang")).toBe("en");
    expect(readCookie(header, "other")).toBe("x y");
    expect(readCookie(header, "missing")).toBeUndefined();
    expect(readCookie(undefined, "sb_lang")).toBeUndefined();
    expect(preferencesFromCookies((n) => readCookie(header, n))).toEqual({
      locale: "en",
      theme: "dark",
    });
    expect(preferencesFromCookies(() => undefined)).toEqual({ locale: "id", theme: "system" });
    expect(parseLocale("fr")).toBe("id");
    expect(parseTheme("<script>")).toBe("system");
  });

  it("writes sb_lang / sb_theme whenever the preference changes", () => {
    function Toggle() {
      const { setLocale, setTheme } = usePreferences();
      return (
        <>
          <button onClick={() => setLocale("en")}>en</button>
          <button onClick={() => setTheme("dark")}>dark</button>
        </>
      );
    }
    render(
      <PreferencesProvider>
        <Toggle />
      </PreferencesProvider>,
    );
    fireEvent.click(screen.getByText("en"));
    fireEvent.click(screen.getByText("dark"));
    expect(readPreferenceCookies()).toEqual({ locale: "en", theme: "dark" });
    expect(localStorage.getItem("second-brain-locale")).toBe("en");
  });

  it("backfills the cookie from localStorage for installs that predate it", () => {
    localStorage.setItem("second-brain-locale", "en");
    render(<PreferencesProvider>{null}</PreferencesProvider>);
    expect(readPreferenceCookies().locale).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

function Title() {
  const { t } = usePreferences();
  return <h1>{t("landingTitle")}</h1>;
}

function app(locale: Locale) {
  return (
    <PreferencesProvider initialLocale={locale}>
      <Title />
    </PreferencesProvider>
  );
}

describe("SSR language", () => {
  it("renders the cookie language on the server and hydrates without a mismatch", async () => {
    const html = renderToString(app("en"));
    // The server HTML is already English: no Indonesian first paint.
    expect(html).toContain("A second brain for your tasks and notes");
    expect(html).not.toContain("Otak kedua");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    localStorage.setItem("second-brain-locale", "en");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRecoverableError = vi.fn();
    await act(async () => {
      hydrateRoot(container, app("en"), { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(container.textContent).toBe("A second brain for your tasks and notes");
    container.remove();
  });
});
