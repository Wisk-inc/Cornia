import type { OpenAIOAuthProvider } from "@openai-oauth/ai-sdk"
import { generateImage } from "ai"
import { errorMessage } from "./openai"
import { writeWorkspaceFile } from "./workspace"

/** The only image model ChatGPT OAuth serves. */
export const IMAGE_MODEL = "gpt-image-2"

/** Used when falling back to a plain API key, which serves the older name too. */
const API_KEY_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1"]

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024"

export type GeneratedImage = {
	path: string
	mediaType: string
	bytes: number
	prompt: string
	source: "chatgpt" | "api-key"
}

/**
 * Thrown when neither route could produce an image. `hint` is the part worth
 * putting in front of a user — the raw upstream message for a 403 is just
 * "Forbidden", which tells nobody why.
 */
export class ImageGenerationError extends Error {
	readonly status: number
	readonly hint: string

	constructor(message: string, status: number, hint: string) {
		super(message)
		this.name = "ImageGenerationError"
		this.status = status
		this.hint = hint
	}
}

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48) || "image"

const statusOf = (error: unknown): number | undefined => {
	const candidate = error as { statusCode?: unknown; status?: unknown }
	if (typeof candidate?.statusCode === "number") {
		return candidate.statusCode
	}
	return typeof candidate?.status === "number" ? candidate.status : undefined
}

/**
 * Image generation is gated separately from chat: the account has to be on a
 * plan that includes it, and the token has to carry the image scope. A signed-in
 * account with working chat can still be refused here, which is why "Forbidden"
 * on its own is so confusing.
 */
const isForbidden = (error: unknown): boolean => {
	const status = statusOf(error)
	if (status === 401 || status === 403) {
		return true
	}
	const message = errorMessage(error).toLowerCase()
	return (
		message.includes("forbidden") ||
		message.includes("not allowed") ||
		message.includes("unauthorized") ||
		message.includes("does not have access")
	)
}

const hintFor = (error: unknown): string => {
	const status = statusOf(error)
	if (isForbidden(error)) {
		return process.env.OPENAI_API_KEY
			? "Your ChatGPT account refused the image request, and the OPENAI_API_KEY fallback failed too. Check that the key is valid and that its project has image generation enabled."
			: "Your ChatGPT account is not allowed to generate images — it needs a paid plan with image generation, and the OAuth token has to carry the image scope. Set OPENAI_API_KEY in the environment to generate through a regular API key instead."
	}
	if (status === 429) {
		return "You have hit the image rate limit on this account. Wait a moment and try again."
	}
	if (status === 400) {
		return "The request itself was rejected — usually the prompt was refused by the safety filter. Rephrase it and try again."
	}
	return "Chat still works; only image generation failed."
}

const base64ToBytes = (value: string): Uint8Array => {
	const binary = Buffer.from(value, "base64")
	return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength)
}

/**
 * Second route, used only when the ChatGPT account refuses. Talks to the public
 * Images API directly so no extra provider package is needed.
 */
const generateWithApiKey = async (
	prompt: string,
	size: ImageSize | undefined,
	signal: AbortSignal | undefined,
): Promise<{ bytes: Uint8Array; mediaType: string }> => {
	const apiKey = process.env.OPENAI_API_KEY
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not set.")
	}

	let lastError: unknown
	for (const model of API_KEY_IMAGE_MODELS) {
		const response = await fetch(
			`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/images/generations`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ model, prompt, n: 1, ...(size ? { size } : {}) }),
				signal,
			},
		)
		const body = await response.text()
		if (!response.ok) {
			lastError = Object.assign(
				new Error(`Images API returned ${response.status}.`),
				{ statusCode: response.status, responseBody: body },
			)
			// An unknown model is worth retrying under the older name; anything
			// else (auth, quota, a refused prompt) will fail the same way twice.
			if (response.status !== 404 && response.status !== 400) {
				break
			}
			continue
		}

		const parsed = JSON.parse(body) as {
			data?: Array<{ b64_json?: string; url?: string }>
		}
		const encoded = parsed.data?.[0]?.b64_json
		if (encoded) {
			return { bytes: base64ToBytes(encoded), mediaType: "image/png" }
		}
		const url = parsed.data?.[0]?.url
		if (url) {
			const image = await fetch(url, { signal })
			return {
				bytes: new Uint8Array(await image.arrayBuffer()),
				mediaType: image.headers.get("content-type") ?? "image/png",
			}
		}
		lastError = new Error("The Images API returned no image data.")
	}
	throw lastError ?? new Error("The Images API returned no image data.")
}

/**
 * Generates an image and saves it into the conversation workspace. Tries the
 * signed-in ChatGPT account first, then a plain API key if one is configured.
 */
export const generateWorkspaceImage = async ({
	sessionId,
	prompt,
	provider,
	size,
	filename,
	signal,
}: {
	sessionId: string
	prompt: string
	provider: OpenAIOAuthProvider
	size?: ImageSize
	filename?: string
	signal?: AbortSignal
}): Promise<GeneratedImage> => {
	let bytes: Uint8Array
	let mediaType = "image/png"
	let source: GeneratedImage["source"] = "chatgpt"
	let firstError: unknown

	try {
		const result = await generateImage({
			model: provider.image(IMAGE_MODEL),
			prompt,
			...(size ? { size } : {}),
			abortSignal: signal,
		})
		bytes = result.image.uint8Array
		mediaType = result.image.mediaType
	} catch (error) {
		firstError = error
		if (!isForbidden(error) || !process.env.OPENAI_API_KEY) {
			throw new ImageGenerationError(
				errorMessage(error),
				statusOf(error) ?? 502,
				hintFor(error),
			)
		}
		try {
			const fallback = await generateWithApiKey(prompt, size, signal)
			bytes = fallback.bytes
			mediaType = fallback.mediaType
			source = "api-key"
		} catch (fallbackError) {
			throw new ImageGenerationError(
				`${errorMessage(firstError)} (API key fallback: ${errorMessage(fallbackError)})`,
				statusOf(firstError) ?? 502,
				hintFor(fallbackError),
			)
		}
	}

	const extension = mediaType.split("/")[1] ?? "png"
	const name = filename?.trim()
		? filename.replace(/^\/+/, "")
		: `images/${slugify(prompt)}-${Date.now()}.${extension}`
	const saved = await writeWorkspaceFile(sessionId, name, bytes)

	return {
		path: saved.relative,
		mediaType,
		bytes: saved.bytes,
		prompt,
		source,
	}
}
