"use client"

export type TerminalEntry = {
	id: string
	source: "agent" | "user"
	command: string
	cwd: string
	running: boolean
	exitCode?: number | null
	stdout?: string
	stderr?: string
	durationMs?: number
	timedOut?: boolean
	error?: string
	at: number
}

const MAX_ENTRIES = 200
const EMPTY: TerminalEntry[] = []

/**
 * One shared scrollback per conversation, so the terminal panel shows the
 * commands the agent ran alongside the ones the user typed. It lives in memory
 * only: the sandbox itself is the durable part, this is just the transcript.
 */
const entriesBySession = new Map<string, TerminalEntry[]>()
const listeners = new Set<() => void>()

const emit = () => {
	for (const listener of listeners) {
		listener()
	}
}

export const subscribeTerminal = (listener: () => void): (() => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export const terminalEntries = (sessionId: string): TerminalEntry[] =>
	entriesBySession.get(sessionId) ?? EMPTY

const write = (sessionId: string, entries: TerminalEntry[]) => {
	entriesBySession.set(
		sessionId,
		entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries,
	)
	emit()
}

export const pushTerminalEntry = (
	sessionId: string,
	entry: TerminalEntry,
): void => {
	const current = terminalEntries(sessionId)
	// Tool parts re-render as they stream, so the same call can arrive twice.
	if (current.some((existing) => existing.id === entry.id)) {
		updateTerminalEntry(sessionId, entry.id, entry)
		return
	}
	write(sessionId, [...current, entry])
}

export const updateTerminalEntry = (
	sessionId: string,
	id: string,
	changes: Partial<TerminalEntry>,
): void => {
	const current = terminalEntries(sessionId)
	const index = current.findIndex((entry) => entry.id === id)
	if (index === -1) {
		return
	}
	const existing = current[index] as TerminalEntry
	const updated = { ...existing, ...changes, id, at: existing.at }
	// Skip the write when nothing actually moved, so a re-render cannot loop.
	if (
		updated.running === existing.running &&
		updated.stdout === existing.stdout &&
		updated.stderr === existing.stderr &&
		updated.exitCode === existing.exitCode &&
		updated.error === existing.error
	) {
		return
	}
	const next = [...current]
	next[index] = updated
	write(sessionId, next)
}

export const clearTerminal = (sessionId: string): void => {
	if (terminalEntries(sessionId).length === 0) {
		return
	}
	write(sessionId, [])
}
