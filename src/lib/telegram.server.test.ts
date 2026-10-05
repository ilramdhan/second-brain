import { describe, expect, it, vi } from "vitest";

import {
  callTelegram,
  sendTelegram,
  TELEGRAM_MAX_TEXT,
  telegramBotUsername,
  telegramDeepLink,
} from "./telegram.server";

describe("telegramBotUsername", () => {
  it("strips @ and validates the username", () => {
    expect(telegramBotUsername({ TELEGRAM_BOT_USERNAME: "@SecondBrainBot" })).toBe(
      "SecondBrainBot",
    );
    expect(telegramBotUsername({ TELEGRAM_BOT_USERNAME: "bad name" })).toBeNull();
    expect(telegramBotUsername({})).toBeNull();
  });
});

describe("telegramDeepLink", () => {
  it("adds a valid start payload", () => {
    expect(telegramDeepLink("SecondBrainBot", "K7QM4XPA")).toBe(
      "https://t.me/SecondBrainBot?start=K7QM4XPA",
    );
  });
  it("drops an invalid payload", () => {
    expect(telegramDeepLink("SecondBrainBot", "a b")).toBe("https://t.me/SecondBrainBot");
  });
});

describe("callTelegram", () => {
  it("reports a missing token without calling the API", async () => {
    const fetchImpl = vi.fn();
    const err = await callTelegram("sendMessage", {}, { token: "", fetchImpl });
    expect(err).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the Bot API with the token in the path", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const err = await callTelegram("sendMessage", { chat_id: 1 }, { token: "123:abc", fetchImpl });
    expect(err).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123:abc/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns an error string without leaking the token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async () => new Response('{"ok":false,"description":"Forbidden"}', { status: 403 }),
    );
    const err = await callTelegram("sendMessage", {}, { token: "123:secret", fetchImpl });
    expect(err).toBe("Telegram gagal [403]");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("123:secret");
    spy.mockRestore();
  });
});

describe("sendTelegram", () => {
  it("truncates long messages", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "1:x");
    await sendTelegram("42", "a".repeat(TELEGRAM_MAX_TEXT + 100));
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.text).toHaveLength(TELEGRAM_MAX_TEXT);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
