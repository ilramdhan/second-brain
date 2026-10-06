import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { preferencesFromCookies, readPreferenceCookies } from "./preference-cookies";

/**
 * Initial language/theme for the root route loader. On the server it reads the request cookies
 * (so the SSR HTML, `<html lang>` and the hydration render agree); in the browser (client-side
 * navigations) it reads `document.cookie`. The Start compiler drops the server branch, and with
 * it the `@tanstack/react-start/server` import, from the client bundle.
 */
export const getInitialPreferences = createIsomorphicFn()
  .server(() => preferencesFromCookies((name) => getCookie(name)))
  .client(() => readPreferenceCookies());
