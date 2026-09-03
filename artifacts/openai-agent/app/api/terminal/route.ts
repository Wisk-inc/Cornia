import { requireUser } from "../../lib/auth"
import { requireFeature, resolveEntitlements } from "../../lib/entitlements"
import { errorMessage } from "../../lib/openai"
import { checkCommandAllowed, runCommand } from "../../lib/terminal"

export const dynamic = "force-dynamic"
export const maxDuration = 300

type TerminalRequestBody = {
	sessionId?: string
	command?: string
	cwd?: string
	timeoutMs?: number
}

/**
 * The user's own line into the same sandbox the agent works in. Same workspace,
 * same guard rails — anything typed here lands next to the files the agent
 * wrote, which is the point.
 */
export async function POST(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}

	const locked = requireFeature(await resolveEntitlements(), "terminal")
	if (locked) {
		return locked
	}

	const body = (await request.json().catch(() => ({}))) as TerminalRequestBody
	const sessionId = body.sessionId?.trim()
	const command = body.command?.trim()

	if (!sessionId || !command) {
		return Response.json(
			{ error: "`sessionId` and `command` are required." },
			{ status: 400 },
		)
	}

	const blocked = checkCommandAllowed(command)
	if (blocked) {
		return Response.json({ error: blocked }, { status: 400 })
	}

	try {
		const result = await runCommand({
			sessionId,
			command,
			cwd: body.cwd,
			timeoutMs: body.timeoutMs,
			signal: request.signal,
		})
		return Response.json(result, {
			headers: { "cache-control": "no-store" },
		})
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 500 })
	}
}
