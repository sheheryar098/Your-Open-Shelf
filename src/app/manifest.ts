import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YOS — Your Open Shelf",
    short_name: "YOS",
    description: "A community book exchange powered by credits.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f1",
    theme_color: "#1f6b5c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
