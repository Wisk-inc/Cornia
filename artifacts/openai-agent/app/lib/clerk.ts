/**
 * Clerk is opt-in. `NEXT_PUBLIC_*` values are inlined at build time, so this
 * same check works on the server and in the browser: with no publishable key
 * the app skips the account layer entirely and behaves exactly as it did
 * before, rather than erroring on every request.
 */
export const clerkPublishableKey =
	process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""

export const clerkEnabled = clerkPublishableKey.length > 0
