import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { requireUser } from "../../../lib/auth"
import {
	type CodeJob,
	listJobs,
	newJobId,
	staleJobs,
	writeJob,
} from "../../../lib/codeJobs"
import { isRunning, runJob } from "../../../lib/codeRunner"
import { requireFeature, resolveEntitlements } from "../../../lib/entitlements"
import { githubConfigured } from "../../../lib/github"
import { loadCatalogCached, pickDefaultModel } from "../../../lib/models"
import {
	errorMessage,
	providerCredentials,
	transportFromRequest,
} from "../../../lib/openai"
import { planAllowsModel } from "../../../lib/plans"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const slugBranch = (task: string): string =>
	`cornia/${
		task
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "task"
	}-${Date.now().toString(36)}`

/**
 * Lists this user's jobs, and hands any that were interrupted back to a runner.
 *
 * A job whose process died stops heartbeating; the next poll finds it stale and
 * restarts it from its own transcript. That is what makes an interrupted run
 * continue on its own rather than sitting at "running" for ever.
 */
export async function GET(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}
	const entitlements = await resolveEntitlements()
	const locked = requireFeature(entitlements, "corniaCode")
	if (locked) {
		return locked
	}

	const userId = entitlements.userId ?? "local"

	try {
		const abandoned = (await staleJobs(userId)).filter(
			(job) => !isRunning(job.id),
		)
		if (abandoned.length > 0) {
			const openai = createOpenAIOAuth(providerCredentials(request))
			for (const job of abandoned) {
				// Deliberately not awaited: resuming must not hold up the listing.
				void runJob(job.id, openai)
			}
		}
	} catch {
		// A resume that cannot start is reported by the job's own status; it must
		// not stop the list from rendering.
	}

	return Response.json(
		{ jobs: await listJobs(userId) },
		{ headers: { "cache-control": "no-store" } },
	)
}

type CreateBody = {
	repo?: string
	baseBranch?: string
	task?: string
	model?: string
}

/** Starts a job and returns immediately; the work continues in the background. */
export async function POST(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}
	const entitlements = await resolveEntitlements()
	const locked = requireFeature(entitlements, "corniaCode")
	if (locked) {
		return locked
	}

	if (!githubConfigured) {
		return Response.json(
			{ error: "GitHub is not connected yet.", needsSetup: true },
			{ status: 503 },
		)
	}

	const body = (await request.json().catch(() => ({}))) as CreateBody
	const repo = body.repo?.trim()
	const task = body.task?.trim()

	if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !task) {
		return Response.json(
			{ error: "`repo` (owner/name) and `task` are required." },
			{ status: 400 },
		)
	}

	let openai: ReturnType<typeof createOpenAIOAuth>
	try {
		openai = createOpenAIOAuth(providerCredentials(request))
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 401 })
	}

	const catalog = await loadCatalogCached(transportFromRequest(request))
	const model =
		body.model?.trim() ||
		(catalog ? pickDefaultModel(catalog.models) : undefined)

	if (!model) {
		return Response.json(
			{ error: "No model available. Reload and try again." },
			{ status: 503 },
		)
	}
	// Same rule as chat: the plan decides, not the request body.
	if (!planAllowsModel(entitlements.plan, model)) {
		return Response.json(
			{ error: `${model} is not included in ${entitlements.plan.name}.` },
			{ status: 403 },
		)
	}

	const now = Date.now()
	const job: CodeJob = {
		id: newJobId(),
		userId: entitlements.userId ?? "local",
		repo,
		branch: slugBranch(task),
		baseBranch: body.baseBranch?.trim() || "main",
		task,
		model,
		status: "queued",
		steps: [],
		createdAt: now,
		updatedAt: now,
		attempts: 0,
		heartbeatAt: now,
	}
	await writeJob(job)

	// Fire and forget — the response is the job, not the result.
	void runJob(job.id, openai)

	return Response.json({ job }, { status: 202 })
}
