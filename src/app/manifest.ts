import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinançasG",
    short_name: "FinançasG",
    description: "Lançamentos e acompanhamento financeiro com modo offline móvel",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f0e8",
    theme_color: "#0f172a",
    lang: "pt-BR",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml"
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml"
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
