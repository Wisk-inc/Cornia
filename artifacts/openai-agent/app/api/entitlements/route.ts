import { requireUser } from "../../lib/auth"
import { resolveEntitlements, toView } from "../../lib/entitlements"
import { FREE_MODEL } from "../../lib/plans"
import { readUsage } from "../../lib/usage"

export const dynamic = "force-dynamic"

/**
 * What the signed-in account may do, and how much of its allowance is left.
 *
 * The browser uses this to decide what to draw — which models to grey out,
 * which panels to offer. It is a convenience, not a gate: every route re-derives
 * the same answer for itself, so a client that lies to itself about this
 * response still gets refused when it tries to act on the lie.
 */
export async function GET() {
	const denied = await requireUser()
	if (denied) {
		return denied
	}

	const entitlements = await resolveEntitlements()
	const usage = await readUsage(entitlements.userId, entitlements.plan)

	return Response.json(
		{
			...toView(entitlements),
			freeModel: FREE_MODEL,
			usage,
		},
		{ headers: { "cache-control": "no-store" } },
	)
}
