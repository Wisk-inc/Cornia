import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { requireUser } from "../../../../lib/auth"
import { readJob, STALE_AFTER_MS, updateJob } from "../../../../lib/codeJobs"
import { isRunning, runJob } from "../../../../lib/codeRunner"
import {
	requireFeature,
	resolveEntitlements,
} from "../../../../lib/entitlements"
import { providerCredentials } from "../../../../lib/openai"

export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** One job's live state. Resumes it if its runner has gone away. */
export async function GET(request: Request, context: Context) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}
	const entitlements = await resolveEntitlements()
	const locked = requireFeature(entitlements, "corniaCode")
	if (locked) {
		return locked
	}

	const { id } = await context.params
	const job = await readJob(id)
	// A job belonging to someone else is not theirs to see.
	if (!job || job.userId !== (entitlements.userId ?? "local")) {
		return Response.json({ error: "No such job." }, { status: 404 })
	}

	const stale =
		(job.status === "running" || job.status === "queued") &&
		Date.now() - job.heartbeatAt > STALE_AFTER_MS &&
		!isRunning(job.id)

	if (stale) {
		try {
			void runJob(job.id, createOpenAIOAuth(providerCredentials(request)))
		} catch {
			// Reported through the job's own status on the next poll.
		}
	}

	return Response.json(
		{ job, live: isRunning(job.id) || stale },
		{ headers: { "cache-control": "no-store" } },
	)
}

/** Cancels a job. The runner checks the status between steps and stops. */
export async function DELETE(_request: Request, context: Context) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}
	const entitlements = await resolveEntitlements()
	const locked = requireFeature(entitlements, "corniaCode")
	if (locked) {
		return locked
	}

	const { id } = await context.params
	const job = await readJob(id)
	if (!job || job.userId !== (entitlements.userId ?? "local")) {
		return Response.json({ error: "No such job." }, { status: 404 })
	}

	return Response.json({
		job: await updateJob(id, { status: "cancelled" }),
	})
}
