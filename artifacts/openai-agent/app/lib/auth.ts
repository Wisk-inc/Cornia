import { auth } from "@clerk/nextjs/server"
import { clerkEnabled } from "./clerk"

/**
 * Guards an API route.
 *
 * Returns a 401 response when the caller has no account, or `null` to carry on.
 * Every route that touches a workspace goes through this: a workspace id is
 * just a string in a URL, so without it anyone who guessed one could read
 * another person's files or run commands in their sandbox.
 *
 * With no Clerk key configured there is no account layer at all, so the check
 * passes — that is the single-user local setup, not a hole in a deployed one.
 */
export const requireUser = async (): Promise<Response | null> => {
	if (!clerkEnabled) {
		return null
	}

	const { userId } = await auth()
	if (!userId) {
		return Response.json(
			{ error: "Sign in to use this workspace." },
			{ status: 401 },
		)
	}
	return null
}
