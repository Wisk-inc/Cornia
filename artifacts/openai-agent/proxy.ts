import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

/**
 * Clerk is optional. With no publishable key the app runs exactly as it did
 * before — straight to the ChatGPT sign-in — so a checkout with no `.env.local`
 * still works instead of failing on every request.
 */
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

/**
 * No route matching here on purpose. Clerk deprecated `createRouteMatcher`
 * because a path list in the proxy can drift from how Next actually routes a
 * request, which is exactly how a protected resource ends up reachable. This
 * only makes `auth()` available; each API route checks for itself, in
 * `requireUser` (app/lib/auth.ts).
 */
export default clerkEnabled ? clerkMiddleware() : () => NextResponse.next()

export const config = {
	matcher: [
		// Everything except Next's own assets and ordinary static files.
		"/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf|webmanifest)$).*)",
		"/(api|trpc)(.*)",
		// Clerk's auto-proxy path, which must not be rewritten.
		"/__clerk/:path*",
	],
}
