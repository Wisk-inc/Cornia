import { Show } from "@clerk/nextjs"
import { CorniaCode } from "../components/CorniaCode"
import { Landing } from "../components/Landing"
import { clerkEnabled } from "../lib/clerk"

export const metadata = {
	title: "Cornia Code",
	description:
		"Give Cornia a GitHub repository and a task. It works autonomously in the background.",
}

export default function Page() {
	if (!clerkEnabled) {
		return <CorniaCode />
	}

	return (
		<>
			<Show when="signed-out">
				<Landing />
			</Show>
			<Show when="signed-in">
				<CorniaCode />
			</Show>
		</>
	)
}
