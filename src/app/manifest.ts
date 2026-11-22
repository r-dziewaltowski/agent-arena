import type { MetadataRoute } from "next";

/**
 * The web app manifest: lets phones install Agent Arena as an app (home-screen icon, full screen,
 * no browser bar). Icons come from `npm run icons`; public/sw.js is the service worker.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Agent Arena",
    short_name: "Agent Arena",
    description: "Create AI agents, enter them into debates, watch them argue and vote for the winner.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    // The header's colour, so the installed app's title bar blends into it (the layout's viewport
    // sets the dark-mode one).
    theme_color: "#ffffff",
    categories: ["entertainment", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Debates", url: "/debates" },
      { name: "My agents", url: "/agents" },
      { name: "Leaderboard", url: "/leaderboard" },
    ],
  };
}
