import type { MetadataRoute } from "next";
import { buildManifest } from "@/lib/pwa/manifest";

/** Served at /manifest.webmanifest; Next adds the <link rel="manifest"> to every page. */
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest();
}
