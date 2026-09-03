import { requireUser } from "../../../lib/auth"
import { requireFeature, resolveEntitlements } from "../../../lib/entitlements"
import {
	GITHUB_APP_INSTALL_URL,
	GitHubError,
	githubConfigured,
	listRepos,
} from "../../../lib/github"

export const dynamic = "force-dynamic"

/** Repositories Cornia Code can work in. */
export async function GET() {
	const denied = await requireUser()
	if (denied) {
		return denied
	}
	const locked = requireFeature(await resolveEntitlements(), "corniaCode")
	if (locked) {
		return locked
	}

	if (!githubConfigured) {
		return Response.json(
			{
				error: "GitHub is not connected yet.",
				installUrl: GITHUB_APP_INSTALL_URL,
				needsSetup: true,
			},
			{ status: 503 },
		)
	}

	try {
		return Response.json(
			{ repos: await listRepos() },
			{ headers: { "cache-control": "no-store" } },
		)
	} catch (error) {
		const status = error instanceof GitHubError ? error.status : 502
		return Response.json(
			{
				error: error instanceof Error ? error.message : String(error),
				installUrl: GITHUB_APP_INSTALL_URL,
				needsSetup: status === 401 || status === 403 || status === 503,
			},
			{ status },
		)
	}
}
