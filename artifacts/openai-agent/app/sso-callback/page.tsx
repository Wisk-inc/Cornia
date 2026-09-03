"use client"

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs"
import { SpinnerIcon } from "../components/icons"
import { clerkEnabled } from "../lib/clerk"

/**
 * Where Google and Apple send the browser back to. The Clerk component
 * finishes the handshake and then navigates on; this page only has to exist.
 *
 * With no Clerk key there is no provider mounted above this, so the component
 * would throw during prerender — hence the guard rather than a bare render.
 */
export default function SSOCallbackPage() {
	if (!clerkEnabled) {
		return (
			<main className="signIn">
				<h1>Nothing to finish</h1>
				<p>
					This app is running without Clerk, so there is no sign-in to complete.
				</p>
				<a className="buttonPrimary" href="/">
					Go to the app
				</a>
			</main>
		)
	}

	return (
		<main className="signIn">
			<SpinnerIcon className="icon spin" />
			<p>Finishing sign-in…</p>
			<AuthenticateWithRedirectCallback
				signInFallbackRedirectUrl="/"
				signUpFallbackRedirectUrl="/"
			/>
		</main>
	)
}
