import { requireUser } from "../../lib/auth"
import { resolveEntitlements } from "../../lib/entitlements"
import { readHistory, readUsage } from "../../lib/usage"

export const dynamic = "force-dynamic"

/** Current allowance plus daily history, for the account page's chart. */
export async function GET(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}

	const days = Number(new URL(request.url).searchParams.get("days") ?? "14")
	const entitlements = await resolveEntitlements()

	return Response.json(
		{
			plan: entitlements.plan.id,
			planName: entitlements.plan.name,
			usage: await readUsage(entitlements.userId, entitlements.plan),
			history: await readHistory(
				entitlements.userId,
				Number.isFinite(days) ? days : 14,
			),
		},
		{ headers: { "cache-control": "no-store" } },
	)
}
