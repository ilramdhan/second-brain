import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { isDemo } from "@/lib/app-mode";
import { useI18n, type MessageKey } from "@/lib/preferences";

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
  const demo = isDemo();
  const { t } = useI18n();
  const [message, setMessage] = useState<MessageKey>(demo ? "demoDisabled" : "authGcalConnecting");
  useEffect(() => {
    // The demo never connects Google Calendar: do not forward anything to the opener.
    if (demo) return;
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
      setMessage(error === "access_denied" ? "authGcalDenied" : "authGcalIncomplete");
    else setMessage("authGcalDone");
    window.setTimeout(() => window.close(), 500);
  }, [demo]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-foreground">
      {t(message)}
    </main>
  );
}
