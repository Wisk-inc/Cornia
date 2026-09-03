"use client"

import { UserButton, useUser } from "@clerk/nextjs"
import { clerkEnabled } from "../lib/clerk"

/**
 * Clerk's hooks and components need a `ClerkProvider` above them, which only
 * exists when a publishable key is configured. Isolating them here means a
 * build with no Clerk keys can still render — and still prerender — every page,
 * instead of failing on a hook that has nothing to talk to.
 */
function SignedInEmail() {
	const { user } = useUser()
	return <>{user?.primaryEmailAddress?.emailAddress ?? "Signed in"}</>
}

export function AccountEmail() {
	return clerkEnabled ? <SignedInEmail /> : <>Local account</>
}

export function AccountAvatar() {
	return clerkEnabled ? <UserButton /> : null
}
