import path from "path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo has a root lockfile; pin tracing to this app.
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Tree-shake icon / motion barrels so first compile stays smaller.
    optimizePackageImports: [
      "lucide-react",
      "@phosphor-icons/react",
      "motion",
    ],
  },
}

export default nextConfig
