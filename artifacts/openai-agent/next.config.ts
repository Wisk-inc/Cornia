import type { NextConfig } from "next"

const allowedDevOrigins = [
	"127.0.0.1",
	"localhost",
	"*.replit.dev",
	"*.repl.co",
	"*.app.github.dev",
	"*.gitpod.io",
	process.env.REPLIT_DEV_DOMAIN,
]

const nextConfig: NextConfig = {
	// Hosted dev environments (Replit, Codespaces, Gitpod) proxy from their own
	// domain, which Next blocks by default.
	allowedDevOrigins: allowedDevOrigins.filter(
		(origin): origin is string => Boolean(origin),
	),
	transpilePackages: [
		"@openai-oauth/core",
		"@openai-oauth/react",
		"@openai-oauth/web",
	],
  async rewrites() {
    return [{ source: "/agent-api/:path*", destination: "/api/:path*" }]
  },
}

export default nextConfig
