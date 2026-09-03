"use client"

import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import {
	pushTerminalEntry,
	subscribeTerminal,
	type TerminalEntry,
	terminalEntries,
	updateTerminalEntry,
	clearTerminal,
} from "../lib/terminalBus"
import {
	CloseIcon,
	SparkleIcon,
	SpinnerIcon,
	TerminalIcon,
	TrashIcon,
	UserIcon,
} from "./icons"

const EMPTY: TerminalEntry[] = []
const HISTORY_KEY = "agent.terminal.history.v1"

const exitLabel = (entry: TerminalEntry): string => {
	if (entry.running) {
		return "running"
	}
	if (entry.error) {
		return "error"
	}
	if (entry.timedOut) {
		return "timed out"
	}
	return `exit ${entry.exitCode ?? "?"}`
}

function Line({ entry }: { entry: TerminalEntry }) {
	const failed =
		!entry.running &&
		(entry.error !== undefined || entry.timedOut || entry.exitCode !== 0)

	return (
		<div className={`termEntry ${failed ? "failed" : ""}`}>
			<div className="termPrompt">
				<span
					className="termSource"
					title={
						entry.source === "agent"
							? "Run by the agent"
							: "Run by you in this panel"
					}
				>
					{entry.source === "agent" ? (
						<SparkleIcon className="icon xs" />
					) : (
						<UserIcon className="icon xs" />
					)}
				</span>
				<span className="termCwd">{entry.cwd || "."}</span>
				<span className="termDollar">$</span>
				<code className="termCommand">{entry.command}</code>
				<span className="termStatus">
					{entry.running ? (
						<SpinnerIcon className="icon xs spin" />
					) : (
						exitLabel(entry)
					)}
					{!entry.running && entry.durationMs !== undefined
						? ` · ${(entry.durationMs / 1000).toFixed(1)}s`
						: ""}
				</span>
			</div>

			{entry.stdout?.trim() ? <pre className="termOut">{entry.stdout}</pre> : null}
			{entry.stderr?.trim() ? (
				<pre className="termOut err">{entry.stderr}</pre>
			) : null}
			{entry.error ? <pre className="termOut err">{entry.error}</pre> : null}
		</div>
	)
}

/**
 * A real terminal into the conversation's sandbox — the same directory the
 * agent works in, so what it wrote is right there to run, and what it ran is
 * right there in the scrollback.
 */
export function TerminalPanel({
	sessionId,
	onClose,
	onWorkspaceChanged,
}: {
	sessionId: string
	onClose: () => void
	onWorkspaceChanged: () => void
}) {
	const entries = useSyncExternalStore(
		subscribeTerminal,
		() => terminalEntries(sessionId),
		() => EMPTY,
	)

	const [command, setCommand] = useState("")
	const [busy, setBusy] = useState(false)
	const [history, setHistory] = useState<string[]>([])
	const [historyIndex, setHistoryIndex] = useState(-1)
	const scrollRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(HISTORY_KEY)
			const parsed: unknown = raw ? JSON.parse(raw) : []
			if (Array.isArray(parsed)) {
				setHistory(parsed.filter((item): item is string => typeof item === "string"))
			}
		} catch {
			// No history is fine.
		}
		inputRef.current?.focus()
	}, [])

	// Follow the newest output, the way a terminal does.
	// biome-ignore lint/correctness/useExhaustiveDependencies: new output is the scroll trigger
	useEffect(() => {
		const element = scrollRef.current
		if (element) {
			element.scrollTop = element.scrollHeight
		}
	}, [entries])

	const run = useCallback(
		async (raw: string) => {
			const line = raw.trim()
			if (!line || busy) {
				return
			}

			const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
			pushTerminalEntry(sessionId, {
				id,
				source: "user",
				command: line,
				cwd: ".",
				running: true,
				at: Date.now(),
			})
			setBusy(true)
			setCommand("")
			setHistoryIndex(-1)
			setHistory((current) => {
				const next = [line, ...current.filter((item) => item !== line)].slice(0, 50)
				try {
					window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
				} catch {}
				return next
			})

			try {
				const response = await fetch("/agent-api/terminal", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId, command: line }),
				})
				const payload = (await response.json()) as {
					stdout?: string
					stderr?: string
					exitCode?: number | null
					durationMs?: number
					timedOut?: boolean
					cwd?: string
					error?: string
				}
				if (!response.ok) {
					throw new Error(payload.error ?? `Failed (HTTP ${response.status}).`)
				}
				updateTerminalEntry(sessionId, id, {
					running: false,
					stdout: payload.stdout,
					stderr: payload.stderr,
					exitCode: payload.exitCode ?? null,
					durationMs: payload.durationMs,
					timedOut: payload.timedOut,
					cwd: payload.cwd ?? ".",
				})
				// A command almost always leaves something behind on disk.
				onWorkspaceChanged()
			} catch (error) {
				updateTerminalEntry(sessionId, id, {
					running: false,
					error: error instanceof Error ? error.message : String(error),
				})
			} finally {
				setBusy(false)
				inputRef.current?.focus()
			}
		},
		[busy, sessionId, onWorkspaceChanged],
	)

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault()
			void run(command)
			return
		}
		if (event.key === "ArrowUp" && history.length > 0) {
			event.preventDefault()
			const next = Math.min(historyIndex + 1, history.length - 1)
			setHistoryIndex(next)
			setCommand(history[next] ?? "")
			return
		}
		if (event.key === "ArrowDown" && historyIndex >= 0) {
			event.preventDefault()
			const next = historyIndex - 1
			setHistoryIndex(next)
			setCommand(next < 0 ? "" : (history[next] ?? ""))
		}
	}

	return (
		<aside className="terminalPanel">
			<div className="filesHeader">
				<TerminalIcon className="icon sm" />
				<span style={{ flex: 1 }}>Terminal</span>
				<button
					aria-label="Clear the terminal transcript"
					className="iconButton"
					onClick={() => clearTerminal(sessionId)}
					title="Clear"
					type="button"
				>
					<TrashIcon className="icon sm" />
				</button>
				<button
					aria-label="Close terminal"
					className="iconButton"
					onClick={onClose}
					type="button"
				>
					<CloseIcon className="icon sm" />
				</button>
			</div>

			<div className="termScroll" ref={scrollRef}>
				{entries.length === 0 ? (
					<p className="filesEmpty">
						A shell in this chat's sandbox — the same directory the agent works
						in. Try <code>ls -la</code>, <code>python3 --version</code> or{" "}
						<code>npm install zod</code>. Commands the agent runs appear here
						too.
					</p>
				) : (
					entries.map((entry) => <Line entry={entry} key={entry.id} />)
				)}
			</div>

			<div className="termInputRow">
				<span className="termDollar">$</span>
				<input
					aria-label="Terminal command"
					autoCapitalize="off"
					autoComplete="off"
					autoCorrect="off"
					className="termInput"
					disabled={busy}
					onChange={(event) => setCommand(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={busy ? "Running…" : "Type a command and press Enter"}
					ref={inputRef}
					spellCheck={false}
					value={command}
				/>
				{busy ? <SpinnerIcon className="icon sm spin" /> : null}
			</div>
		</aside>
	)
}
