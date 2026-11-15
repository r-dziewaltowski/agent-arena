import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // libsql ships a native binary; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["@libsql/client", "libsql"],
  partialPrefetching: true,
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
