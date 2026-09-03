"use client"

import { useChat } from "@ai-sdk/react"
import { openaiAuthHeaders } from "@openai-oauth/react"
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AgentModel } from "../lib/models"
import type { Attachment, Conversation, Settings } from "../lib/types"
import { Composer } from "./Composer"
import {
	BrainIcon,
	CheckIcon,
	ChevronDownIcon,
	CodeIcon,
	CopyIcon,
	GlobeIcon,
	ImageIcon,
	RefreshIcon,
	SparkleIcon,
	SpinnerIcon,
	TerminalIcon,
	WarningIcon,
} from "./icons"
import { Markdown } from "./Markdown"
import { ToolCall, type ToolPart } from "./ToolCall"

const SUGGESTIONS = [
	{
		icon: CodeIcon,
		label: "Build a CLI todo app in Python and test it",
		prompt:
			"Build a small command line todo app in Python with add/list/done commands, store tasks in JSON, then write tests and run them in the sandbox.",
	},
	{
		icon: TerminalIcon,
		label: "Benchmark two sorting approaches",
		prompt:
			"Write two implementations of a sort in Python, benchmark them on 100k random integers in the sandbox, and show me the timings in a table.",
	},
	{
		icon: GlobeIcon,
		label: "Research a library and summarise it",
		prompt:
			"Search the web for the current recommended way to do server-sent events in Node, then write a working example file and run it.",
	},
	{
		icon: ImageIcon,
		label: "Generate a logo concept",
		prompt:
			"Generate a clean, minimal logo for a developer tool called Sandbox.",
	},
]

/** The model's thinking, collapsed by default and openable like ChatGPT's. */
function Thinking({ text, live }: { text: string; live: boolean }) {
	const [open, setOpen] = useState(false)
	const words = text.trim().split(/\s+/).length

	return (
		<div className={`thinking ${open ? "open" : ""}`}>
			<button
				aria-expanded={open}
				className="thinkingHeader"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<BrainIcon className="icon sm" />
				<span className={live ? "shimmer" : undefined}>
					{live ? "Thinking" : "Thought"}
				</span>
				<span className="thinkingMeta">
					{words} word{words === 1 ? "" : "s"}
				</span>
				<ChevronDownIcon className={`icon sm chevron ${open ? "up" : ""}`} />
			</button>
			{open ? (
				<div className="thinkingBody">
					<Markdown content={text} />
				</div>
			) : null}
		</div>
	)
}

const messageText = (message: UIMessage): string =>
	message.parts
		.filter((part) => part.type === "text")
		.map((part) => (part as { text: string }).text)
		.join("\n")

/**
 * A cheap fingerprint of what is actually on screen.
 *
 * `useChat` hands back a fresh `messages` array on renders where nothing
 * changed, so an effect keyed on the array itself fires every render. That
 * effect saves the conversation, the save re-renders the tree, and the cycle
 * repeats until React aborts with "Maximum update depth exceeded". Keying on
 * this string instead means the effect only runs when the content moved.
 */
const messagesSignature = (messages: UIMessage[]): string =>
	messages
		.map((message) => {
			const parts = message.parts
				.map((part) => {
					if (part.type === "text" || part.type === "reasoning") {
						return `${part.type}:${(part as { text: string }).text.length}`
					}
					const state = (part as { state?: string }).state
					return state ? `${part.type}:${state}` : part.type
				})
				.join(",")
			return `${message.id}[${parts}]`
		})
		.join("|")

// While a turn streams, history is written at most this often. The final state
// is always flushed when the turn ends.
const SAVE_THROTTLE_MS = 400

export function ChatView({
	conversation,
	model,
	modelInfo,
	settings,
	onMessagesChange,
	onTitle,
	onWorkspaceChanged,
}: {
	conversation: Conversation
	model?: string
	modelInfo?: AgentModel
	settings: Settings
	onMessagesChange: (messages: UIMessage[]) => void
	onTitle: (title: string) => void
	onWorkspaceChanged: () => void
}) {
	const [imageMode, setImageMode] = useState(false)
	const [imageError, setImageError] = useState<string | undefined>(undefined)
	const [generatingImage, setGeneratingImage] = useState(false)
	const [copiedId, setCopiedId] = useState<string | undefined>(undefined)
	const threadRef = useRef<HTMLDivElement>(null)
	const stickToBottom = useRef(true)
	const titleRequested = useRef(conversation.title !== "New chat")

	// The chat instance keeps the transport it was built with, so the request
	// options are read from a ref at send time — switching model, role or effort
	// mid-conversation then applies to the very next message.
	const configRef = useRef({ model, modelInfo, settings })
	configRef.current = { model, modelInfo, settings }

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
			api: "/agent-api/chat",
				prepareSendMessagesRequest: async ({ messages, body }) => {
					const config = configRef.current
					return {
						headers: {
							...(await openaiAuthHeaders()),
							"content-type": "application/json",
						},
						body: {
							...body,
							messages,
							sessionId: conversation.id,
							model: config.model,
							roleId: config.settings.roleId,
							customInstructions: config.settings.customInstructions,
							reasoningEffort:
								config.settings.reasoningEffort === "none"
									? undefined
									: config.settings.reasoningEffort,
							supportsReasoning: config.modelInfo
								? config.modelInfo.reasoning
								: true,
						},
					}
				},
			}),
		[conversation.id],
	)

	const {
		messages,
		sendMessage,
		setMessages,
		status,
		stop,
		regenerate,
		error,
	} = useChat<UIMessage>({
		id: conversation.id,
		messages: conversation.messages,
		transport,
		// Coalesce stream chunks into ~20 renders a second. Without it every token
		// re-renders the whole thread, which is what made a long answer (or an
		// image landing mid-turn) feel like the UI had locked up.
		experimental_throttle: 50,
	})

	const busy = status === "submitted" || status === "streaming"

	// Everything below reads the newest messages through this ref, so effects and
	// callbacks never have to list the array itself as a dependency.
	const messagesRef = useRef(messages)
	messagesRef.current = messages

	const signature = useMemo(() => messagesSignature(messages), [messages])
	const savedSignature = useRef(signature)

	// Persist history when it actually changes, throttled while streaming.
	useEffect(() => {
		if (savedSignature.current === signature) {
			return
		}
		if (!busy) {
			savedSignature.current = signature
			onMessagesChange(messagesRef.current)
			return
		}
		const timer = window.setTimeout(() => {
			savedSignature.current = messagesSignature(messagesRef.current)
			onMessagesChange(messagesRef.current)
		}, SAVE_THROTTLE_MS)
		return () => window.clearTimeout(timer)
	}, [signature, busy, onMessagesChange])

	// Refresh the file panel and name the chat once a turn finishes. Keyed on the
	// status transition, not on the messages, so a streaming turn does not reload
	// the workspace on every token.
	const previousStatus = useRef(status)
	useEffect(() => {
		const wasBusy =
			previousStatus.current === "submitted" ||
			previousStatus.current === "streaming"
		previousStatus.current = status

		const messages = messagesRef.current
		if (status !== "ready" || !wasBusy || messages.length === 0) {
			return
		}
		onWorkspaceChanged()

		if (titleRequested.current || !settings.autoTitle || !model) {
			return
		}
		const firstUser = messages.find((message) => message.role === "user")
		const firstAssistant = messages.find(
			(message) => message.role === "assistant",
		)
		if (!firstUser || !firstAssistant) {
			return
		}
		titleRequested.current = true
		void (async () => {
			try {
				const response = await fetch("/agent-api/title", {
					method: "POST",
					headers: {
						...(await openaiAuthHeaders()),
						"content-type": "application/json",
					},
					body: JSON.stringify({
						model,
						prompt: messageText(firstUser).slice(0, 1200),
						reply: messageText(firstAssistant).slice(0, 600),
					}),
				})
				const payload = (await response.json()) as { title?: string }
				if (payload.title) {
					onTitle(payload.title)
				}
			} catch {
				// A missing title is not worth surfacing.
			}
		})()
	}, [status, model, settings.autoTitle, onTitle, onWorkspaceChanged])

	// Keep the view pinned to the newest content unless the user scrolled up.
	useEffect(() => {
		const thread = threadRef.current
		if (!thread || !stickToBottom.current) {
			return
		}
		thread.scrollTop = thread.scrollHeight
	}, [])

	const onScroll = useCallback(() => {
		const thread = threadRef.current
		if (!thread) {
			return
		}
		const distance =
			thread.scrollHeight - thread.scrollTop - thread.clientHeight
		stickToBottom.current = distance < 120
	}, [])

	// biome-ignore lint/correctness/useExhaustiveDependencies: new content is the scroll trigger
	useEffect(() => {
		const thread = threadRef.current
		if (!thread || !stickToBottom.current) {
			return
		}
		thread.scrollTop = thread.scrollHeight
	}, [signature])

	/**
	 * Reads the message list from the ref rather than closing over it, so the
	 * callback identity stays stable and the two `setMessages` calls below always
	 * build on the newest state instead of the snapshot this render captured.
	 */
	const generateImage = useCallback(
		async (prompt: string) => {
			setGeneratingImage(true)
			setImageError(undefined)
			const before = messagesRef.current
			const userMessage: UIMessage = {
				id: `img-user-${Date.now()}`,
				role: "user",
				parts: [{ type: "text", text: prompt }],
			}
			setMessages([...before, userMessage])

			try {
				const response = await fetch("/agent-api/image", {
					method: "POST",
					headers: {
						...(await openaiAuthHeaders()),
						"content-type": "application/json",
					},
					body: JSON.stringify({ prompt, sessionId: conversation.id }),
				})
				const raw = await response.text()
				const payload = (
					raw.trim().length > 0 ? JSON.parse(raw) : {}
				) as {
					path?: string
					error?: string
					hint?: string
				}
				if (!response.ok || !payload.path) {
					throw new Error(
						[payload.error ?? `Image generation failed (HTTP ${response.status}).`, payload.hint]
							.filter(Boolean)
							.join(" "),
					)
				}
				const fileUrl = `/agent-api/workspace/file?sessionId=${encodeURIComponent(conversation.id)}&path=${encodeURIComponent(payload.path)}`
				setMessages([
					...before,
					userMessage,
					{
						id: `img-assistant-${Date.now()}`,
						role: "assistant",
						parts: [
							{
								type: "text",
								text: `Generated \`${payload.path}\`.\n\n![${prompt}](${fileUrl})`,
							},
						],
					},
				])
				onWorkspaceChanged()
			} catch (imageFailure) {
				setImageError(
					imageFailure instanceof Error
						? imageFailure.message
						: String(imageFailure),
				)
				// Drop the optimistic user turn so the failed prompt can be retried.
				setMessages(before)
			} finally {
				setGeneratingImage(false)
			}
		},
		[conversation.id, setMessages, onWorkspaceChanged],
	)

	const handleSend = useCallback(
		(text: string, attachments: Attachment[]) => {
			if (imageMode) {
				void generateImage(text)
				setImageMode(false)
				return
			}

			const files: FileUIPart[] = attachments
				.filter((attachment) => attachment.isImage && attachment.dataUrl)
				.map((attachment) => ({
					type: "file",
					mediaType: attachment.mediaType,
					filename: attachment.name,
					url: attachment.dataUrl as string,
				}))

			const notes = attachments.map(
				(attachment) =>
					`- \`${attachment.path}\`${attachment.isImage ? " (image, also attached below)" : ""}`,
			)
			const body =
				notes.length > 0
					? `${text}\n\nFiles saved to the workspace:\n${notes.join("\n")}`
					: text

			stickToBottom.current = true
			void sendMessage({ text: body, files })
		},
		[generateImage, imageMode, sendMessage],
	)

	const copyMessage = async (message: UIMessage) => {
		try {
			await navigator.clipboard?.writeText(messageText(message))
			setCopiedId(message.id)
			window.setTimeout(() => setCopiedId(undefined), 1600)
		} catch {
			// Clipboard permissions can be stricter in embedded browsers.
		}
	}

	const lastAssistantId = [...messages]
		.reverse()
		.find((message) => message.role === "assistant")?.id

	return (
		<>
			{messages.length === 0 ? (
				<div className="emptyState">
					<h1>What are we building?</h1>
					<p>
						Ask a question, or hand over a task — it plans, writes files, runs
						them in a sandbox and reports back.
					</p>
					<div className="suggestions">
						{SUGGESTIONS.map((suggestion) => (
							<button
								className="suggestion"
								key={suggestion.label}
								onClick={() => handleSend(suggestion.prompt, [])}
								type="button"
							>
								<suggestion.icon className="icon sm" />
								{suggestion.label}
							</button>
						))}
					</div>
				</div>
			) : (
				<div className="thread" onScroll={onScroll} ref={threadRef}>
					<div className="threadInner">
						{messages.map((message) => {
							if (message.role === "user") {
								const images = message.parts.filter(
									(part) => part.type === "file",
								) as FileUIPart[]
								return (
									<article className="turn user" key={message.id}>
										{images.length > 0 ? (
											<div className="userAttachments">
												{images.map((file) => (
													// biome-ignore lint/performance/noImgElement: data URL preview
													<img
														alt={file.filename ?? "Attachment"}
														className="attachmentImage"
														key={`${message.id}-${file.filename ?? file.url.slice(-16)}`}
														src={file.url}
													/>
												))}
											</div>
										) : null}
										<div className="userBubble">{messageText(message)}</div>
									</article>
								)
							}

							return (
								<article
									className={`turn assistant ${message.id === lastAssistantId ? "last" : ""}`}
									key={message.id}
								>
									<div className="assistantBody">
										{message.parts.map((part, partIndex) => {
											const key = `${message.id}-${partIndex}`

											if (part.type === "reasoning") {
												const text = (part as { text: string }).text
												if (!text.trim()) {
													return null
												}
												return (
													<Thinking
														key={key}
														live={busy && message.id === lastAssistantId}
														text={text}
													/>
												)
											}

											if (part.type === "text") {
												const text = (part as { text: string }).text
												return text.length > 0 ? (
													<Markdown content={text} key={key} />
												) : null
											}

											if (
												part.type.startsWith("tool-") ||
												part.type === "dynamic-tool"
											) {
												return (
													<ToolCall
														key={key}
														part={part as unknown as ToolPart}
														sessionId={conversation.id}
													/>
												)
											}

											return null
										})}

										{(message.metadata as { stoppedAtStepLimit?: number })
											?.stoppedAtStepLimit && !busy ? (
											<div className="errorBanner">
												<WarningIcon className="icon sm" />
												<span>
													Stopped after{" "}
													{
														(message.metadata as { stoppedAtStepLimit: number })
															.stoppedAtStepLimit
													}{" "}
													tool steps without finishing.{" "}
													<button
														onClick={() =>
															void sendMessage({ text: "Keep going." })
														}
														type="button"
													>
														Continue
													</button>
												</span>
											</div>
										) : null}

										{busy && message.id === lastAssistantId ? (
											<div className="reasoningHead">
												<SpinnerIcon className="icon xs spin" />
												<span className="shimmer">Working</span>
											</div>
										) : null}

										<div className="turnActions">
											<button
												className="turnAction"
												onClick={() => void copyMessage(message)}
												type="button"
											>
												{copiedId === message.id ? (
													<CheckIcon className="icon xs" />
												) : (
													<CopyIcon className="icon xs" />
												)}
												{copiedId === message.id ? "Copied" : "Copy"}
											</button>
											{message.id === lastAssistantId && !busy ? (
												<button
													className="turnAction"
													onClick={() => void regenerate()}
													type="button"
												>
													<RefreshIcon className="icon xs" />
													Try again
												</button>
											) : null}
										</div>
									</div>
								</article>
							)
						})}

						{status === "submitted" ? (
							<div className="turn assistant">
								<div className="reasoningHead">
									<SparkleIcon className="icon xs" />
									<span className="shimmer">Thinking</span>
								</div>
							</div>
						) : null}

						{error ? (
							<div className="errorBanner">
								<WarningIcon className="icon sm" />
								<span>
									{error.message}{" "}
									<button onClick={() => void regenerate()} type="button">
										Try again
									</button>
								</span>
							</div>
						) : null}

						{imageError ? (
							<div className="errorBanner">
								<WarningIcon className="icon sm" />
								<span>{imageError}</span>
							</div>
						) : null}
					</div>
				</div>
			)}

			<Composer
				busy={busy || generatingImage}
				imageMode={imageMode}
				onSend={handleSend}
				onStop={() => void stop()}
				onToggleImageMode={() => setImageMode((current) => !current)}
				sessionId={conversation.id}
			/>
		</>
	)
}
