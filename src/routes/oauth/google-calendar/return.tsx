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
    // Google redirects here with ?code=&state= (or ?error=). The code is useless without the
    // PKCE verifier sealed in `state`, which only the server can open for the signed-in user.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const success = Boolean(code && state && !error);
    window.opener?.postMessage(
      success
        ? { type: "googleCalendarComplete", code, state }
        : { type: "googleCalendarFailed", error },
      window.location.origin,
    );
    // Drop the one-time code from the address bar and history.
    window.history.replaceState(null, "", window.location.pathname);
    // The message mirrors the one-shot postMessage above, which can only run on the client.
    if (!success)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setMessage(error === "access_denied" ? "Izin ditolak." : "Koneksi tidak selesai.");
    else setMessage("Berhasil. Jendela ini dapat ditutup.");
    window.setTimeout(() => window.close(), 500);
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-foreground">
      {message}
    </main>
  );
}
