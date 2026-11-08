import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YOS — Your Open Shelf",
    short_name: "YOS",
    description: "A community book exchange powered by credits.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f3ee",
    theme_color: "#2a3f86",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
