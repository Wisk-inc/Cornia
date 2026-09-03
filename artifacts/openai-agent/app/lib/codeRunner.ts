import { tool } from "@ai-sdk/provider-utils"
import type { OpenAIOAuthProvider } from "@openai-oauth/ai-sdk"
import { generateText, stepCountIs } from "ai"
import { z } from "zod"
import {
	appendStep,
	type CodeJob,
	readJob,
	updateJob,
} from "./codeJobs"
import {
	commentOnIssue,
	createBranch,
	deleteRepoFile,
	listTree,
	openPullRequest,
	readRepoFile,
	writeRepoFile,
} from "./github"
import { STATELESS_PROVIDER_OPTIONS } from "./models"
import { errorMessage } from "./openai"

/** How many tool round trips one attempt may take before it pauses. */
const STEP_LIMIT = 40

/** Runners currently alive in this process, so a job is never doubled up. */
const running = new Set<string>()

/** Thrown to unwind the agent loop when a job is cancelled mid-run. */
class JobCancelled extends Error {
	constructor() {
		super("Cancelled")
		this.name = "JobCancelled"
	}
}

export const isRunning = (id: string): boolean => running.has(id)

const SYSTEM = `You are Cornia Code, working autonomously on a real GitHub repository.

Everything you do is real: files you write are committed, branches you create exist, comments you post are visible. Work on the task branch you are given — never commit to the default branch.

## How to work

- Start by orienting: \`github_list_files\` for the layout, then \`github_read_file\` on the files that matter. Never edit a file you have not read.
- Make the smallest change that does the job. Match the surrounding code's style, naming and structure rather than importing your own.
- Write whole files with \`github_write_file\`. Each call is a commit, so give it a real commit message in the imperative: "Add retry to the upload path", not "update".
- When the task is done, open a pull request with \`github_open_pull_request\` describing what changed and why.
- If something blocks you — a file that is not there, a convention you cannot infer, a task that turns out to be ambiguous — say so plainly in your final message rather than guessing and committing something wrong.
- Finish with a short summary of what you changed and the pull request link.

You may be resumed after an interruption. The transcript of what you already did is given to you: read it, work out what is left, and carry on from there rather than starting again.`

const codeTools = (job: CodeJob) => ({
	github_list_files: tool({
		description:
			"List every file and directory on the task branch. Start here to learn the layout.",
		inputSchema: z.object({
			prefix: z
				.string()
				.optional()
				.describe("Only paths starting with this, e.g. `src/`."),
		}),
		execute: async ({ prefix }) => {
			const tree = await listTree(job.repo, job.branch)
			const matched = prefix
				? tree.filter((entry) => entry.path.startsWith(prefix))
				: tree
			return {
				count: matched.length,
				// A whole tree can be thousands of entries; the model needs a map,
				// not an inventory.
				entries: matched
					.slice(0, 400)
					.map((entry) =>
						entry.type === "tree" ? `${entry.path}/` : entry.path,
					),
				truncated: matched.length > 400,
			}
		},
	}),

	github_read_file: tool({
		description: "Read a file from the task branch. Always read before editing.",
		inputSchema: z.object({ path: z.string() }),
		execute: async ({ path }) => {
			const file = await readRepoFile(job.repo, path, job.branch)
			return {
				path: file.path,
				lines: file.content.split("\n").length,
				content: file.content.slice(0, 60_000),
			}
		},
	}),

	github_write_file: tool({
		description:
			"Create or replace a file on the task branch. Each call makes one commit, so write a real commit message.",
		inputSchema: z.object({
			path: z.string(),
			content: z.string().describe("The complete new contents of the file."),
			message: z
				.string()
				.describe("Commit message, imperative mood, one line."),
		}),
		execute: async ({ path, content, message }) => {
			const result = await writeRepoFile({
				fullName: job.repo,
				path,
				content,
				message,
				branch: job.branch,
			})
			return { ...result, branch: job.branch }
		},
	}),

	github_delete_file: tool({
		description: "Delete a file from the task branch.",
		inputSchema: z.object({ path: z.string(), message: z.string() }),
		execute: async ({ path, message }) =>
			await deleteRepoFile({
				fullName: job.repo,
				path,
				message,
				branch: job.branch,
			}),
	}),

	github_open_pull_request: tool({
		description:
			"Open a pull request from the task branch once the work is done.",
		inputSchema: z.object({
			title: z.string(),
			body: z.string().describe("What changed and why. Markdown."),
		}),
		execute: async ({ title, body }) =>
			await openPullRequest({
				fullName: job.repo,
				title,
				body,
				head: job.branch,
				base: job.baseBranch,
			}),
	}),

	github_comment: tool({
		description: "Comment on an issue or pull request in this repository.",
		inputSchema: z.object({ number: z.number().int(), body: z.string() }),
		execute: async ({ number, body }) =>
			await commentOnIssue(job.repo, number, body),
	}),
})

/** What a resumed run is told about the work already done. */
const transcriptOf = (job: CodeJob): string => {
	if (job.steps.length === 0) {
		return ""
	}
	const lines = job.steps
		.filter((step) => step.kind !== "note")
		.map((step) =>
			step.detail ? `- ${step.label}: ${step.detail}` : `- ${step.label}`,
		)
	return lines.length === 0
		? ""
		: `\n\n## Already done (attempt ${job.attempts})\n\nYou were interrupted. This is what you had done so far:\n\n${lines.join("\n")}\n\nCarry on from there. Do not redo work that is already committed.`
}

/**
 * Runs a job to completion in the background.
 *
 * Deliberately not awaited by the request that starts it: the HTTP call returns
 * as soon as the job exists, and the UI follows along by polling. Each tool call
 * is written to disk as it finishes, which is both the progress feed and the
 * transcript a resumed run reads.
 */
export const runJob = async (
	jobId: string,
	provider: OpenAIOAuthProvider,
): Promise<void> => {
	if (running.has(jobId)) {
		return
	}
	running.add(jobId)

	try {
		const started = await readJob(jobId)
		if (!started || started.status === "cancelled") {
			return
		}

		const job =
			(await updateJob(jobId, {
				status: "running",
				attempts: started.attempts + 1,
				heartbeatAt: Date.now(),
			})) ?? started

		await appendStep(jobId, {
			kind: "note",
			label:
				job.attempts > 1
					? `Resumed on ${job.repo} (attempt ${job.attempts})`
					: `Started on ${job.repo}`,
			detail: `branch ${job.branch}`,
		})

		// The branch is created once and reused across attempts, so a resumed run
		// keeps the commits the interrupted one already made.
		const branch = await createBranch(job.repo, job.branch, job.baseBranch)
		if (branch.created) {
			await appendStep(jobId, {
				kind: "note",
				label: `Created branch ${job.branch}`,
				detail: `from ${job.baseBranch}`,
			})
		}

		const result = await generateText({
			model: provider(job.model),
			system: SYSTEM,
			prompt: `Repository: ${job.repo}\nTask branch: ${job.branch} (based on ${job.baseBranch})\n\n## Task\n\n${job.task}${transcriptOf(job)}`,
			tools: codeTools(job),
			stopWhen: stepCountIs(STEP_LIMIT),
			providerOptions: STATELESS_PROVIDER_OPTIONS,
			onStepFinish: async (step) => {
				// Cancellation is a status change on disk, so it is checked between
				// steps rather than signalled — a request that cancels a job may be
				// served by a different process than the one running it.
				const current = await readJob(jobId)
				if (current?.status === "cancelled") {
					throw new JobCancelled()
				}

				for (const call of step.toolCalls) {
					const input = call.input as Record<string, unknown>
					await appendStep(jobId, {
						kind: "tool",
						label: call.toolName,
						detail:
							typeof input?.path === "string"
								? input.path
								: typeof input?.title === "string"
									? input.title
									: undefined,
					})
				}
				if (step.text.trim().length > 0) {
					await appendStep(jobId, {
						kind: "text",
						label: "Note",
						detail: step.text.trim().slice(0, 400),
					})
				}
			},
		})

		await updateJob(jobId, {
			status: "completed",
			summary: result.text.trim().slice(0, 4_000),
			heartbeatAt: Date.now(),
		})
		await appendStep(jobId, { kind: "note", label: "Finished" })
	} catch (error) {
		if (error instanceof JobCancelled) {
			await appendStep(jobId, { kind: "note", label: "Cancelled" })
			await updateJob(jobId, { status: "cancelled", heartbeatAt: Date.now() })
			return
		}
		const message = errorMessage(error)
		await appendStep(jobId, {
			kind: "error",
			label: "Failed",
			detail: message.slice(0, 400),
		})
		await updateJob(jobId, {
			status: "failed",
			error: message,
			heartbeatAt: Date.now(),
		})
	} finally {
		running.delete(jobId)
	}
}
