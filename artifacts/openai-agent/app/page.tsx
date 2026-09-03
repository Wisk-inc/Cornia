import { Show } from "@clerk/nextjs"
import { AgentApp } from "./components/AgentApp"
import { Landing } from "./components/Landing"
import { clerkEnabled } from "./lib/clerk"

/**
 * Signed out, this is the marketing page and the sign-up form. Signed in, it is
 * the agent. With no Clerk key configured the account layer is skipped and the
 * agent is all there is.
 */
export default function Page() {
	if (!clerkEnabled) {
		return <AgentApp />
	}

	return (
		<>
			<Show when="signed-out">
				<Landing />
			</Show>
			<Show when="signed-in">
				<AgentApp />
			</Show>
		</>
	)
}
