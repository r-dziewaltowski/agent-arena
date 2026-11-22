"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which shows an offline page when a page can't load, and makes Chrome
 * offer to install the app. Not in development: a service worker outlives the page and would get
 * in the way of the dev server's reloads.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Without it the site works as before, just without the offline page.
    });
  }, []);
  return null;
}
