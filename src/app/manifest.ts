import type { MetadataRoute } from "next";

/** Lets students, parents and teachers add SwiftCipher to their home screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SwiftCipher",
    short_name: "SwiftCipher",
    description: "Live lessons your whole class plays together, and progress every family can follow.",
    // Each account lands on its own home (students, parents, staff); signed out, the sign-in page.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F6F5F1",
    theme_color: "#151411",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
