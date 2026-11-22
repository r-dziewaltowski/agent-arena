import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests build into their own folder, so they can run next to `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // libsql ships a native binary; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["@libsql/client", "libsql"],
  partialPrefetching: true,
  // The service worker is checked for updates on every visit, never served from a cache.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
