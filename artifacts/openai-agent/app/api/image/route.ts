import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { requireUser } from "../../lib/auth"
import { requireFeature, resolveEntitlements } from "../../lib/entitlements"
import {
	generateWorkspaceImage,
	type ImageSize,
	ImageGenerationError,
} from "../../lib/images"
import {
	errorMessage,
	isAuthError,
	providerCredentials,
} from "../../lib/openai"

export const maxDuration = 120

type ImageRequestBody = {
	prompt?: string
	sessionId?: string
	size?: ImageSize
}

export async function POST(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}

	const locked = requireFeature(await resolveEntitlements(), "imageGeneration")
	if (locked) {
		return locked
	}

	const body = (await request.json().catch(() => ({}))) as ImageRequestBody
	const prompt = body.prompt?.trim()
	const sessionId = body.sessionId?.trim()
	if (!prompt || !sessionId) {
		return Response.json(
			{ error: "`prompt` and `sessionId` are required." },
			{ status: 400 },
		)
	}

	try {
		const openai = createOpenAIOAuth(providerCredentials(request))
		const image = await generateWorkspaceImage({
			sessionId,
			prompt,
			provider: openai,
			size: body.size,
			signal: request.signal,
		})
		return Response.json(image)
	} catch (error) {
		// The hint is the useful half: a bare "Forbidden" from the upstream says
		// nothing about which account setting is missing.
		if (error instanceof ImageGenerationError) {
			return Response.json(
				{ error: error.message, hint: error.hint },
				{ status: error.status === 403 ? 403 : (error.status ?? 502) },
			)
		}
		return Response.json(
			{ error: errorMessage(error) },
			{ status: isAuthError(error) ? 401 : 502 },
		)
	}
}
