import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plan } from "./plans"

/**
 * Where the counters live. A file per user, so the store needs no database and
 * survives a restart; swap `readRecord`/`writeRecord` for a table when there is
 * more than one server process.
 */
const USAGE_ROOT =
	process.env.CORNIA_USAGE_ROOT ?? path.join(process.cwd(), ".cornia-usage")

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** How much daily history the account chart draws. */
export const HISTORY_DAYS = 30
/** Longest window any plan enforces, and so how long raw events are kept. */
const MAX_WINDOW_MS = 24 * HOUR_MS

type UsageRecord = {
	/** Timestamps of billable turns, newest last, trimmed to `MAX_WINDOW_MS`. */
	events: number[]
	/** `YYYY-MM-DD` → turns that day, for the chart. Trimmed to `HISTORY_DAYS`. */
	daily: Record<string, number>
}

const emptyRecord = (): UsageRecord => ({ events: [], daily: {} })

/** A file name that cannot escape the usage directory, whatever the id is. */
const recordPath = (userId: string): string => {
	const safe = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128)
	return path.join(USAGE_ROOT, `${safe || "anonymous"}.json`)
}

const dayKey = (at: number): string =>
	new Date(at).toISOString().slice(0, 10)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const readRecord = async (userId: string): Promise<UsageRecord> => {
	try {
		const parsed: unknown = JSON.parse(
			await readFile(recordPath(userId), "utf8"),
		)
		if (!isRecord(parsed)) {
			return emptyRecord()
		}
		return {
			events: Array.isArray(parsed.events)
				? parsed.events.filter(
						(value): value is number => typeof value === "number",
					)
				: [],
			daily: isRecord(parsed.daily)
				? Object.fromEntries(
						Object.entries(parsed.daily).filter(
							(entry): entry is [string, number] =>
								typeof entry[1] === "number",
						),
					)
				: {},
		}
	} catch {
		// A missing or unreadable file means no usage yet, which is the safe
		// reading: it fails towards letting a paying customer work.
		return emptyRecord()
	}
}

const writeRecord = async (
	userId: string,
	record: UsageRecord,
): Promise<void> => {
	await mkdir(USAGE_ROOT, { recursive: true })
	const target = recordPath(userId)
	// Write-then-rename so a crash mid-write cannot leave a truncated file that
	// would read back as "no usage".
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
	await writeFile(temporary, JSON.stringify(record), "utf8")
	await rename(temporary, target)
}

/**
 * Serialises reads and writes per user within this process. Two turns starting
 * at the same instant would otherwise both read the pre-increment count and one
 * increment would be lost — which is a free turn, every time it happens.
 */
const inFlight = new Map<string, Promise<unknown>>()

const withLock = async <T>(
	userId: string,
	work: () => Promise<T>,
): Promise<T> => {
	const previous = inFlight.get(userId) ?? Promise.resolve()
	const next = previous.then(work, work)
	inFlight.set(
		userId,
		next.catch(() => undefined),
	)
	try {
		return await next
	} finally {
		if (inFlight.get(userId) === next) {
			inFlight.delete(userId)
		}
	}
}

const prune = (record: UsageRecord, now: number): UsageRecord => {
	const oldestEvent = now - MAX_WINDOW_MS
	const oldestDay = dayKey(now - HISTORY_DAYS * DAY_MS)
	return {
		events: record.events.filter((at) => at > oldestEvent),
		daily: Object.fromEntries(
			Object.entries(record.daily).filter(([day]) => day >= oldestDay),
		),
	}
}

export type UsageStatus = {
	planId: Plan["id"]
	/** Turns used inside the plan's window. */
	used: number
	limit: number
	remaining: number
	windowHours: number
	/** When the oldest counted turn falls out of the window, so one comes back. */
	resetsAt: number | null
	exhausted: boolean
}

const statusFrom = (
	record: UsageRecord,
	plan: Plan,
	now: number,
): UsageStatus => {
	const windowMs = plan.windowHours * HOUR_MS
	const inWindow = record.events.filter((at) => at > now - windowMs)
	const used = inWindow.length
	const remaining = Math.max(plan.turnLimit - used, 0)
	const oldest = inWindow[0]

	return {
		planId: plan.id,
		used,
		limit: plan.turnLimit,
		remaining,
		windowHours: plan.windowHours,
		// Only meaningful once something has been spent.
		resetsAt: oldest === undefined ? null : oldest + windowMs,
		exhausted: remaining === 0,
	}
}

/** Reads the allowance without spending any of it. */
export const readUsage = async (
	userId: string | null,
	plan: Plan,
): Promise<UsageStatus> => {
	if (!userId) {
		// Nobody to meter — the local, no-Clerk setup.
		return {
			planId: plan.id,
			used: 0,
			limit: plan.turnLimit,
			remaining: plan.turnLimit,
			windowHours: plan.windowHours,
			resetsAt: null,
			exhausted: false,
		}
	}
	const now = Date.now()
	const record = prune(await readRecord(userId), now)
	return statusFrom(record, plan, now)
}

/**
 * Spends one turn, if there is one to spend.
 *
 * Read and increment happen under the same lock, so the check cannot be won by
 * two requests at once. The returned status is the state *after* the turn, so a
 * caller can report "3 left" without a second read.
 */
export const consumeTurn = async (
	userId: string | null,
	plan: Plan,
): Promise<{ allowed: boolean; status: UsageStatus }> => {
	if (!userId) {
		return { allowed: true, status: await readUsage(userId, plan) }
	}

	return withLock(userId, async () => {
		const now = Date.now()
		const record = prune(await readRecord(userId), now)
		const before = statusFrom(record, plan, now)

		if (before.exhausted) {
			return { allowed: false, status: before }
		}

		const updated: UsageRecord = {
			events: [...record.events, now],
			daily: {
				...record.daily,
				[dayKey(now)]: (record.daily[dayKey(now)] ?? 0) + 1,
			},
		}
		await writeRecord(userId, updated)
		return { allowed: true, status: statusFrom(updated, plan, now) }
	})
}

export type UsageHistoryPoint = { day: string; turns: number }

/**
 * Daily totals for the chart, oldest first, with empty days filled in so the
 * chart has an even axis rather than gaps.
 */
export const readHistory = async (
	userId: string | null,
	days = 14,
): Promise<UsageHistoryPoint[]> => {
	const span = Math.min(Math.max(days, 1), HISTORY_DAYS)
	const record = userId ? await readRecord(userId) : emptyRecord()
	const now = Date.now()

	return Array.from({ length: span }, (_, index) => {
		const day = dayKey(now - (span - 1 - index) * DAY_MS)
		return { day, turns: record.daily[day] ?? 0 }
	})
}
