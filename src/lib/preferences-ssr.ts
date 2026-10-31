import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { preferencesFromCookies, readPreferenceCookies } from "./preference-cookies";
import { LANDING_ENABLED_COOKIE } from "./landing";

/**
 * Initial language/theme for the root route loader. On the server it reads the request cookies
 * (so the SSR HTML, `<html lang>` and the hydration render agree); in the browser (client-side
 * navigations) it reads `document.cookie`. The Start compiler drops the server branch, and with
 * it the `@tanstack/react-start/server` import, from the client bundle.
 */
export const getInitialPreferences = createIsomorphicFn()
  .server(() => preferencesFromCookies((name) => getCookie(name)))
  .client(() => readPreferenceCookies());

/**
 * Checks if landing page is enabled by reading cookie. Server reads from request, client from
 * document.cookie. Default true if cookie not set.
 */
export const getLandingEnabledFromCookie = createIsomorphicFn()
  .server(() => {
    const value = getCookie(LANDING_ENABLED_COOKIE);
    return value === null || value === undefined || value === "true";
  })
  .client(() => {
    if (typeof document === "undefined") return true;
    const match = document.cookie.match(new RegExp(`${LANDING_ENABLED_COOKIE}=([^;]+)`));
    return match ? match[1] === "true" : true;
  });
