import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/oauth/google-calendar/return")({
  head: () => ({
    meta: [
      { title: "Google Calendar — Second Brain" },
      { name: "description", content: "Menyelesaikan koneksi Google Calendar." },
      { property: "og:title", content: "Google Calendar — Second Brain" },
      { property: "og:description", content: "Menyelesaikan koneksi Google Calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GoogleCalendarReturn,
});

function GoogleCalendarReturn() {
  const [message, setMessage] = useState("Menyelesaikan koneksi…");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success") === "true";
    const code = params.get("code");
    window.opener?.postMessage(
      { type: success ? "googleCalendarComplete" : "googleCalendarFailed", code },
      window.location.origin,
    );
    if (!success) setMessage(params.get("error") ?? "Koneksi tidak selesai.");
    else setMessage("Berhasil. Jendela ini dapat ditutup.");
    window.setTimeout(() => window.close(), 500);
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-foreground">
      {message}
    </main>
  );
}
