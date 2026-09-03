import { auth } from "@clerk/nextjs/server"
import { clerkEnabled } from "./clerk"
import { type Plan, type PlanFeature, PLANS, planById } from "./plans"

/**
 * Slugs that mean "this account is on Cornia Max".
 *
 * Clerk's `has({ plan })` matches on a plan *slug*, while the dashboard shows a
 * `cplan_…` id. Rather than guess which was configured, every plausible name is
 * checked — an unknown slug simply returns false, so the extra checks cost
 * nothing and the integration survives someone renaming the plan.
 */
const MAX_PLAN_SLUGS = [
	process.env.NEXT_PUBLIC_CORNIA_MAX_PLAN_SLUG,
	"cornia_max",
	"cornia-max",
	"corniamax",
	"max",
].filter((slug): slug is string => Boolean(slug))

export type Entitlements = {
	userId: string | null
	plan: Plan
	/** True when the plan was read from a real subscription, not a fallback. */
	verified: boolean
}

/**
 * Resolves what the *caller* may do, from the Clerk session alone.
 *
 * Nothing here reads the request body, a header, a cookie the page set, or any
 * other value the browser controls. Every gate in the app funnels through this
 * so that editing the client — a userscript flipping a flag, re-enabling a
 * disabled button, or posting a locked model id straight at the API — changes
 * what the page looks like and nothing about what it is allowed to do.
 */
export const resolveEntitlements = async (): Promise<Entitlements> => {
	// No Clerk configured is the single-user local setup: there is no account to
	// bill, so nothing is withheld.
	if (!clerkEnabled) {
		return { userId: null, plan: PLANS.max, verified: false }
	}

	const { userId, has } = await auth()
	if (!userId) {
		return { userId: null, plan: PLANS.free, verified: false }
	}

	const onMax = MAX_PLAN_SLUGS.some((slug) => {
		try {
			return has({ plan: slug })
		} catch {
			// An unknown slug is a "no", not an error worth failing the request for.
			return false
		}
	})

	return {
		userId,
		plan: onMax ? PLANS.max : PLANS.free,
		verified: true,
	}
}

/** Shape sent to the browser so it knows what to draw. */
export type EntitlementsView = {
	planId: Plan["id"]
	planName: string
	features: PlanFeature[]
	turnLimit: number
	windowHours: number
	maxUploadBytes: number
	models: "all" | "free-only"
}

export const toView = (entitlements: Entitlements): EntitlementsView => ({
	planId: entitlements.plan.id,
	planName: entitlements.plan.name,
	features: [...entitlements.plan.features],
	turnLimit: entitlements.plan.turnLimit,
	windowHours: entitlements.plan.windowHours,
	maxUploadBytes: entitlements.plan.maxUploadBytes,
	models: entitlements.plan.features.has("allModels") ? "all" : "free-only",
})

/**
 * Guard for a route that a plan may not use at all. Returns a 403 carrying the
 * feature name, so the client can show the right upgrade prompt.
 */
export const requireFeature = (
	entitlements: Entitlements,
	feature: PlanFeature,
): Response | null => {
	if (entitlements.plan.features.has(feature)) {
		return null
	}
	return Response.json(
		{
			error: "This feature is not included in your plan.",
			feature,
			plan: entitlements.plan.id,
			upgradeTo: "max",
		},
		{ status: 403 },
	)
}

export { planById }
