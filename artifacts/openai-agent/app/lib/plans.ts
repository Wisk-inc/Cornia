/**
 * What each plan may do.
 *
 * This module is the single source of truth for entitlements and is imported by
 * both the server and the browser. The browser copy only ever decides what to
 * *draw* — every gate that matters is re-derived on the server from the signed-in
 * Clerk session (see `entitlements.ts`), because anything the browser sends can
 * be edited by whoever is sitting in front of it.
 */

export type PlanId = "free" | "max"

/**
 * The Clerk billing plan Cornia Max is sold as.
 *
 * Clerk's checkout takes the `cplan_…` id; `has({ plan })` takes the plan's
 * slug. Both are configurable, because a plan can be recreated in the dashboard
 * without the code changing.
 */
export const MAX_PLAN_ID =
	process.env.NEXT_PUBLIC_CORNIA_MAX_PLAN_ID ?? "cplan_3Ipse6YDIJ52lGkZuW3wYhzgUpG"

/**
 * The one model the free tier can talk to. Kept as a constant because both the
 * allowlist and the "why is this locked" copy need to agree on it.
 */
export const FREE_MODEL = "gpt-5.6-luna"

export type PlanFeature =
	| "allModels"
	/** Choosing a reasoning effort rather than taking the model's default. */
	| "reasoningControl"
	/** The workspace: file panel, uploads, downloads, the sandbox filesystem. */
	| "workspace"
	/** The sandbox shell, and the tools that drive it. */
	| "terminal"
	/** Multi-source research that opens and reads pages. */
	| "deepResearch"
	/** Image generation. */
	| "imageGeneration"
	/** Cornia Code: autonomous work against a GitHub repository. */
	| "corniaCode"
	/** Several models working one task together. */
	| "splitMode"
	/** Calling MCP tools, and registering custom MCP servers. */
	| "mcp"
	/** Saved, named agents with their own instructions and logo. */
	| "customGpts"
	/** Larger uploads and longer context. */
	| "expandedUploads"

export type Plan = {
	id: PlanId
	name: string
	tagline: string
	/** Price in whole US dollars per month. Free is 0. */
	priceUsd: number
	features: ReadonlySet<PlanFeature>
	/** How many turns are allowed inside `windowHours`. */
	turnLimit: number
	/** The rolling window the limit is measured over. */
	windowHours: number
	/** Attachment ceiling, in bytes. */
	maxUploadBytes: number
	/** How many tool round trips one turn may take. */
	stepLimit: number
}

const FREE_FEATURES: PlanFeature[] = []

const MAX_FEATURES: PlanFeature[] = [
	"allModels",
	"reasoningControl",
	"workspace",
	"terminal",
	"deepResearch",
	"imageGeneration",
	"corniaCode",
	"splitMode",
	"mcp",
	"customGpts",
	"expandedUploads",
]

export const PLANS: Record<PlanId, Plan> = {
	free: {
		id: "free",
		name: "Cornia Free",
		tagline: "Everyday chat on GPT-5.6 Luna.",
		priceUsd: 0,
		features: new Set(FREE_FEATURES),
		// 20 turns a day, refilled on a rolling 24-hour window rather than at
		// midnight — so the allowance comes back as it was spent.
		turnLimit: 20,
		windowHours: 24,
		maxUploadBytes: 5 * 1024 * 1024,
		stepLimit: 8,
	},
	max: {
		id: "max",
		name: "Cornia Max",
		tagline: "Every model, every tool, twenty times the usage.",
		priceUsd: 14,
		features: new Set(MAX_FEATURES),
		// 20× the free allowance, measured over a 5-hour window.
		turnLimit: 400,
		windowHours: 5,
		maxUploadBytes: 100 * 1024 * 1024,
		stepLimit: 48,
	},
}

export const planById = (id: string | undefined): Plan =>
	id === "max" ? PLANS.max : PLANS.free

/** Whether a plan may use a given model id. */
export const planAllowsModel = (plan: Plan, modelId: string): boolean =>
	plan.features.has("allModels") || modelId === FREE_MODEL

/**
 * Tools a plan may call. The chat route builds its tool set from this, so a
 * locked tool is not merely hidden — it does not exist in the request the model
 * sees, and cannot be invoked by editing anything client-side.
 */
export const planTools = (plan: Plan): string[] => {
	const tools = ["update_plan", "web_search", "fetch_url"]

	if (plan.features.has("workspace")) {
		tools.push(
			"list_files",
			"read_file",
			"write_file",
			"edit_file",
			"delete_path",
			"clone_repo",
		)
	}
	if (plan.features.has("terminal")) {
		tools.push("run_command", "run_file", "install_package", "uninstall_package")
	}
	if (plan.features.has("deepResearch")) {
		tools.push("deep_research", "extract_code")
	}
	if (plan.features.has("imageGeneration")) {
		tools.push("generate_image")
	}
	// Cornia Code has its own tool set (see `codeRunner.ts`) because it runs
	// against a repository rather than the chat sandbox; nothing to add here.
	return tools
}

/** One line explaining why something is unavailable, for the upgrade prompt. */
export const lockReason = (feature: PlanFeature): string => {
	switch (feature) {
		case "allModels":
			return "Cornia Free runs on GPT-5.6 Luna. Cornia Max unlocks every GPT model on your account."
		case "reasoningControl":
			return "Choosing a reasoning effort is a Cornia Max feature. On Free, each model uses its own default."
		case "workspace":
			return "The workspace — files, uploads and downloads — is a Cornia Max feature."
		case "terminal":
			return "The sandbox terminal is a Cornia Max feature."
		case "deepResearch":
			return "Deep Research reads whole pages across many sites. It is a Cornia Max feature."
		case "imageGeneration":
			return "Image generation is a Cornia Max feature, and is unlimited there."
		case "corniaCode":
			return "Cornia Code works autonomously on your GitHub repositories. It is a Cornia Max feature."
		case "splitMode":
			return "Split mode puts several models on one task together. It is a Cornia Max feature."
		case "mcp":
			return "Calling MCP tools, and adding your own MCP servers, is a Cornia Max feature."
		case "customGpts":
			return "Saving your own named agents is a Cornia Max feature."
		case "expandedUploads":
			return "Larger uploads are a Cornia Max feature."
	}
}
