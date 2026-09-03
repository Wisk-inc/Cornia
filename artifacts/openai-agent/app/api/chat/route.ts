import { requireUser } from "../../lib/auth"
import { resolveEntitlements } from "../../lib/entitlements"
import { FREE_MODEL, planAllowsModel } from "../../lib/plans"
import { consumeTurn } from "../../lib/usage"
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import {
	convertToModelMessages,
	type ModelMessage,
	smoothStream,
	stepCountIs,
	streamText,
	type UIMessage,
} from "ai"
import {
	loadCatalogCached,
	pickDefaultModel,
	providerOptionsFor,
} from "../../lib/models"
import {
	errorMessage,
	providerCredentials,
	transportFromRequest,
} from "../../lib/openai"
import { buildSystemPrompt } from "../../lib/prompt"
import { createAgentTools } from "../../lib/tools"
import { workspaceOutline } from "../../lib/workspace"

export const maxDuration = 300

/**
 * Codex runs with `store: false`, so nothing the model produced is kept
 * server-side and no earlier item can be referenced by id. Two things have to
 * go before history is replayed:
 *
 * 1. Reasoning parts, which can only ever be replayed by reference.
 * 2. The `itemId` the provider stamps onto every assistant text and tool call.
 *    With an id present the SDK sends `{ type: "item_reference", id: "msg_…" }`
 *    (or an input item carrying that id), and the upstream answers
 *    "Item with id 'msg_…' not found. Items are not persisted when `store` is
 *    set to false." Stripping the id makes the SDK inline the turn instead.
 *
 * `providerOptions.openai.store = false` (see `providerOptionsFor`) covers the
 * same ground from the other direction; both are kept because the SDK reads
 * the id from two different places depending on the part type.
 */
const STATE_KEYS = ["itemId", "reasoningEncryptedContent"] as const

const stripItemIds = (
	options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
	const openai = options?.openai
	if (!options || typeof openai !== "object" || openai === null) {
		return options
	}
	const cleaned: Record<string, unknown> = { ...(openai as object) }
	let changed = false
	for (const key of STATE_KEYS) {
		if (key in cleaned) {
			delete cleaned[key]
			changed = true
		}
	}
	return changed ? { ...options, openai: cleaned } : options
}

export const sanitizeForStatelessReplay = (
	messages: ModelMessage[],
): ModelMessage[] =>
	messages.map((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			return message
		}
		const content = message.content
			.filter((part) => part.type !== "reasoning")
			.map((part) => {
				const providerOptions = stripItemIds(
					(part as { providerOptions?: Record<string, unknown> })
						.providerOptions,
				)
				return providerOptions ===
					(part as { providerOptions?: Record<string, unknown> })
						.providerOptions
					? part
					: { ...part, providerOptions }
			})
		return { ...message, content } as ModelMessage
	})

type ChatRequestBody = {
	messages?: UIMessage[]
	sessionId?: string
	model?: string
	roleId?: string
	customInstructions?: string
	reasoningEffort?: string
	verbosity?: "low" | "medium" | "high"
}

export async function POST(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}

	let body: ChatRequestBody
	try {
		body = (await request.json()) as ChatRequestBody
	} catch {
		return Response.json({ error: "Invalid request body." }, { status: 400 })
	}

	const sessionId = body.sessionId?.trim()
	if (!sessionId || !Array.isArray(body.messages)) {
		return Response.json(
			{ error: "`sessionId` and `messages` are required." },
			{ status: 400 },
		)
	}

	// Everything below is decided from the session, never from `body`. A client
	// that asks for a model, an effort or a tool its plan does not include is
	// refused here, whatever the page was edited to send.
	const entitlements = await resolveEntitlements()
	const { plan } = entitlements

	let openai: ReturnType<typeof createOpenAIOAuth>
	try {
		openai = createOpenAIOAuth(providerCredentials(request))
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 401 })
	}

	// The catalog tells us which options this model accepts. If the client never
	// managed to load it, the server resolves a model itself rather than failing.
	const catalog = await loadCatalogCached(transportFromRequest(request))
	const modelId =
		body.model?.trim() ||
		(catalog ? pickDefaultModel(catalog.models) : undefined)

	if (!modelId) {
		return Response.json(
			{
				error:
					"No model available yet. The model list could not be loaded from your ChatGPT account — reload the page, and check that the account is signed in.",
			},
			{ status: 503 },
		)
	}

	if (!planAllowsModel(plan, modelId)) {
		return Response.json(
			{
				error: `${modelId} is not included in ${plan.name}. Cornia Free runs on ${FREE_MODEL}.`,
				feature: "allModels",
				plan: plan.id,
				allowedModel: FREE_MODEL,
				upgradeTo: "max",
			},
			{ status: 403 },
		)
	}

	// Spend the turn only once the request is known to be servable, so a refused
	// model does not cost someone part of their daily allowance.
	const { allowed, status: usage } = await consumeTurn(entitlements.userId, plan)
	if (!allowed) {
		const hours = plan.windowHours
		return Response.json(
			{
				error: `You have used all ${plan.turnLimit} messages in your ${hours}-hour window.`,
				usage,
				plan: plan.id,
				upgradeTo: plan.id === "free" ? "max" : undefined,
			},
			{ status: 402 },
		)
	}

	const modelInfo = catalog?.models.find((model) => model.id === modelId)
	// Choosing an effort is itself a paid feature; on Free the model's own
	// default is used, which is what passing `undefined` here means.
	const providerOptions = providerOptionsFor(
		modelInfo,
		plan.features.has("reasoningControl") ? body.reasoningEffort : undefined,
		plan.features.has("reasoningControl") ? body.verbosity : undefined,
	)

	const outline = await workspaceOutline(sessionId).catch(() => "(empty)")
	const system = buildSystemPrompt({
		roleId: body.roleId,
		customInstructions: body.customInstructions,
		workspaceOutline: outline,
		sessionId,
		modelId,
	})

	const result = streamText({
		model: openai(modelId),
		system,
		messages: sanitizeForStatelessReplay(
			await convertToModelMessages(body.messages),
		),
		tools: createAgentTools({
			sessionId,
			provider: openai,
			plan,
			signal: request.signal,
		}),
		stopWhen: stepCountIs(plan.stepLimit),
		// Later steps in the same turn carry the earlier steps' reasoning and item
		// ids, which hit the same stateless-replay error, so strip them there too.
		prepareStep: ({ messages }) => ({
			messages: sanitizeForStatelessReplay(messages),
		}),
		abortSignal: request.signal,
		providerOptions,
		experimental_transform: smoothStream({ delayInMs: 12, chunking: "word" }),
		onError: ({ error }) => {
			console.error(`[agent] stream error (${modelId}):`, errorMessage(error))
		},
	})

	return result.toUIMessageStreamResponse({
		sendReasoning: true,
		onError: (error) => errorMessage(error),
		// Tells the client when a turn ended because it ran out of steps rather
		// than because the agent was finished.
		messageMetadata: ({ part }) =>
			part.type === "finish" && part.finishReason === "tool-calls"
				? { stoppedAtStepLimit: plan.stepLimit, usage }
				: { usage },
		headers: {
			// Hosted proxies (Replit, nginx) buffer streams unless told not to,
			// which makes a working answer look like it hung.
			"cache-control": "no-cache, no-transform",
			"x-accel-buffering": "no",
		},
	})
}
