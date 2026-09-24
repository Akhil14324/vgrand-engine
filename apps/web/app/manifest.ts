import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CatGPT — AI Chat & Image Studio",
    short_name: "CatGPT",
    description:
      "Chat with AI, plan sales campaigns, and create on-brand images.",
    start_url: "/",
    scope: "/",
    categories: ["productivity", "business"],
    display: "standalone",
    background_color: "#17161c",
    theme_color: "#17161c",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "New chat",
        url: "/",
        icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }],
      },
      {
        name: "Brand",
        url: "/brand",
        icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }],
      },
      {
        name: "Workspaces",
        url: "/workspaces",
        icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }],
      },
    ],
  };
}
