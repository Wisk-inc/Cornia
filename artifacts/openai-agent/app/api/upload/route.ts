import path from "node:path"
import { requireUser } from "../../lib/auth"
import { requireFeature, resolveEntitlements } from "../../lib/entitlements"
import { errorMessage } from "../../lib/openai"
import { isProbablyText, writeWorkspaceFile } from "../../lib/workspace"

export const maxDuration = 60

const TEXT_PREVIEW_CHARS = 4_000

const safeName = (name: string): string => {
	const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")
	return base.length > 0 ? base.slice(0, 80) : `upload-${Date.now()}`
}

/** Saves an attachment straight into the conversation workspace. */
export async function POST(request: Request) {
	const denied = await requireUser()
	if (denied) {
		return denied
	}

	const entitlements = await resolveEntitlements()
	const locked = requireFeature(entitlements, "workspace")
	if (locked) {
		return locked
	}

	try {
		const form = await request.formData()
		const sessionId = String(form.get("sessionId") ?? "").trim()
		const file = form.get("file")

		if (!sessionId || !(file instanceof File)) {
			return Response.json(
				{ error: "`sessionId` and `file` are required." },
				{ status: 400 },
			)
		}
		// The ceiling is part of the plan, so a bigger file is an upgrade prompt
		// rather than a flat refusal.
		const limit = entitlements.plan.maxUploadBytes
		if (file.size > limit) {
			const megabytes = Math.round(limit / (1024 * 1024))
			return Response.json(
				{
					error: `"${file.name}" is larger than the ${megabytes} MB upload limit on ${entitlements.plan.name}.`,
					feature: "expandedUploads",
					plan: entitlements.plan.id,
					upgradeTo: entitlements.plan.id === "free" ? "max" : undefined,
				},
				{ status: 413 },
			)
		}

		const buffer = Buffer.from(await file.arrayBuffer())
		const name = safeName(file.name)
		const target = `uploads/${Date.now().toString(36)}-${name}`
		const saved = await writeWorkspaceFile(sessionId, target, buffer)
		const mediaType = file.type || "application/octet-stream"
		const isImage = mediaType.startsWith("image/")
		const isText = !isImage && isProbablyText(name, buffer)

		return Response.json({
			path: saved.relative,
			name,
			mediaType,
			bytes: saved.bytes,
			isImage,
			isText,
			preview: isText
				? buffer.subarray(0, TEXT_PREVIEW_CHARS).toString("utf8")
				: undefined,
		})
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 500 })
	}
}
