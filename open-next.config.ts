import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  // Build-time pages are immutable for this app. Cache interception serves
  // them before loading the CPU-heavier Next.js server bundle.
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
  routePreloadingBehavior: "none",
});
