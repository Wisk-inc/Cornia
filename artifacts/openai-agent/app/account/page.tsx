import { Show } from "@clerk/nextjs"
import { AccountPage } from "../components/AccountPage"
import { Landing } from "../components/Landing"
import { clerkEnabled } from "../lib/clerk"

export default function Page() {
	if (!clerkEnabled) {
		return <AccountPage />
	}

	return (
		<>
			<Show when="signed-out">
				<Landing />
			</Show>
			<Show when="signed-in">
				<AccountPage />
			</Show>
		</>
	)
}
