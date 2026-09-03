import { tool } from "@ai-sdk/provider-utils"
import type { OpenAIOAuthProvider } from "@openai-oauth/ai-sdk"
import { z } from "zod"
import { generateWorkspaceImage, IMAGE_MODEL } from "./images"
import { deepResearch, extractCode, faviconUrl, siteName } from "./research"
import { fetchPage, webSearch } from "./search"
import {
	PACKAGE_MANAGERS,
	packageCommand,
	runCommand,
	runFileCommand,
} from "./terminal"
import {
	editWorkspaceFile,
	listWorkspace,
	readWorkspaceFile,
	removeWorkspacePath,
	type WorkspaceEntry,
	writeWorkspaceFile,
} from "./workspace"

export { IMAGE_MODEL }

export type AgentToolContext = {
	sessionId: string
	provider: OpenAIOAuthProvider
	signal?: AbortSignal
}

const planStepSchema = z.object({
	title: z.string().describe("Short imperative description of the step."),
	status: z
		.enum(["pending", "in_progress", "completed"])
		.describe("Where this step stands right now."),
})

/** Single-quote for the shell so URLs and branch names cannot inject. */
const shellQuote = (value: string): string =>
	`'${value.replace(/'/g, "'\\''")}'`

export const createAgentTools = ({
	sessionId,
	provider,
	signal,
}: AgentToolContext) => ({
	update_plan: tool({
		description:
			"Record or update the plan for a multi-step task. Call this before starting work and again whenever a step finishes. Keep exactly one step in_progress.",
		inputSchema: z.object({
			steps: z.array(planStepSchema).min(1).max(8),
			note: z
				.string()
				.optional()
				.describe("Optional one-line explanation of a change in direction."),
		}),
		execute: async ({ steps, note }) => ({ steps, note }),
	}),

	list_files: tool({
		description:
			"List files and directories in the sandbox workspace, recursively.",
		inputSchema: z.object({
			path: z
				.string()
				.optional()
				.describe("Directory to list, relative to the workspace root."),
		}),
		execute: async ({ path }) => {
			const entries = await listWorkspace(sessionId, path ?? ".")
			return {
				path: path ?? ".",
				count: entries.length,
				entries: entries.map((entry) => ({
					path: entry.path,
					type: entry.type,
					size: entry.size,
				})),
			}
		},
	}),

	read_file: tool({
		description:
			"Read a UTF-8 text file from the sandbox workspace. Always read before editing.",
		inputSchema: z.object({
			path: z.string().describe("File path relative to the workspace root."),
		}),
		execute: async ({ path }) => {
			const file = await readWorkspaceFile(sessionId, path)
			return {
				path: file.relative,
				truncated: file.truncated,
				lines: file.content.split("\n").length,
				content: file.content,
			}
		},
	}),

	write_file: tool({
		description:
			"Create or overwrite a file in the sandbox workspace. Missing parent directories are created automatically.",
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"File path relative to the workspace root, e.g. src/main.py or docs/README.md.",
				),
			content: z.string().describe("Full contents of the file."),
		}),
		execute: async ({ path, content }) => {
			const result = await writeWorkspaceFile(sessionId, path, content)
			return {
				path: result.relative,
				bytes: result.bytes,
				created: result.created,
				lines: content.split("\n").length,
			}
		},
	}),

	edit_file: tool({
		description:
			"Replace an exact snippet inside an existing file. The snippet must match the file byte for byte.",
		inputSchema: z.object({
			path: z.string(),
			find: z
				.string()
				.describe("Exact text to replace, with enough context to be unique."),
			replace: z.string().describe("Replacement text."),
			replace_all: z
				.boolean()
				.optional()
				.describe(
					"Replace every occurrence instead of requiring a unique match.",
				),
		}),
		execute: async ({ path, find, replace, replace_all }) => {
			const result = await editWorkspaceFile(
				sessionId,
				path,
				find,
				replace,
				replace_all ?? false,
			)
			return { path: result.relative, replacements: result.replacements }
		},
	}),

	delete_path: tool({
		description: "Delete a file or directory from the sandbox workspace.",
		inputSchema: z.object({ path: z.string() }),
		execute: async ({ path }) => ({
			path: await removeWorkspacePath(sessionId, path),
			deleted: true,
		}),
	}),

	run_command: tool({
		description:
			"Run a shell command in the sandbox terminal, inside the workspace. The sandbox has internet access: use it to execute code, run tests, clone repositories, and install packages (npm, pip, apt-free tools). Long installs need a larger timeout_ms.",
		inputSchema: z.object({
			command: z.string().describe("Shell command, e.g. `python3 main.py`."),
			cwd: z
				.string()
				.optional()
				.describe("Working directory relative to the workspace root."),
			timeout_ms: z
				.number()
				.int()
				.min(1000)
				.max(300000)
				.optional()
				.describe(
					"Kill the command after this many milliseconds (default 60000).",
				),
		}),
		execute: async ({ command, cwd, timeout_ms }) => {
			const result = await runCommand({
				sessionId,
				command,
				cwd,
				timeoutMs: timeout_ms,
				signal,
			})
			const failed = result.timedOut || result.exitCode !== 0
			return {
				...result,
				failed,
				// Spelled out so a failure reads as work to do, not a dead end.
				hint: failed
					? result.timedOut
						? "The command hit its timeout. Re-run it with a larger timeout_ms, or run it in the background and poll."
						: "Non-zero exit. Read stderr above, fix the cause, and run it again. Do not report success until it exits 0."
					: undefined,
			}
		},
	}),

	clone_repo: tool({
		description:
			"Clone a public git repository into the sandbox workspace so its code can be read, run and modified.",
		inputSchema: z.object({
			url: z
				.string()
				.describe("Repository URL, e.g. https://github.com/owner/name."),
			directory: z
				.string()
				.optional()
				.describe(
					"Target directory inside the workspace. Defaults to the repo name.",
				),
			depth: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("History depth; 0 clones the full history. Defaults to 1."),
			branch: z.string().optional(),
		}),
		execute: async ({ url, directory, depth, branch }) => {
			if (!/^(https?:\/\/|git@)/.test(url)) {
				throw new Error(
					"Only http(s) and git@ repository URLs can be cloned into the sandbox.",
				)
			}

			const target =
				directory?.trim() ||
				(url.split("/").pop() ?? "repo").replace(/\.git$/, "")
			const depthFlag = depth === 0 ? "" : `--depth ${depth ?? 1}`
			const branchFlag = branch ? `--branch ${shellQuote(branch)}` : ""
			const result = await runCommand({
				sessionId,
				command: `git clone ${depthFlag} ${branchFlag} ${shellQuote(url)} ${shellQuote(target)}`,
				timeoutMs: 600_000,
				signal,
			})

			if (result.exitCode !== 0) {
				throw new Error(
					`Clone failed (exit ${result.exitCode}). ${result.stderr || result.stdout}`.trim(),
				)
			}

			// An empty listing is a fine answer here: the clone succeeded either way.
			const entries: WorkspaceEntry[] = await listWorkspace(
				sessionId,
				target,
			).catch(() => [])
			return {
				path: target,
				url,
				branch,
				files: entries.length,
				top: entries
					.filter((entry) => !entry.path.slice(target.length + 1).includes("/"))
					.slice(0, 40)
					.map((entry) =>
						entry.type === "directory" ? `${entry.path}/` : entry.path,
					),
				durationMs: result.durationMs,
			}
		},
	}),

	web_search: tool({
		description:
			"Search the web for a quick answer or a link. For anything the user calls research, or that needs more than one source, use `deep_research` instead — it reads the pages rather than just listing them.",
		inputSchema: z.object({
			query: z.string(),
			count: z.number().int().min(1).max(10).optional(),
		}),
		execute: async ({ query, count }) => {
			const response = await webSearch(query, count ?? 6, signal)
			return {
				...response,
				results: response.results.map((result) => ({
					...result,
					site: siteName(result.url),
					favicon: faviconUrl(result.url),
				})),
			}
		},
	}),

	fetch_url: tool({
		description:
			"Fetch a web page or API response and return it as readable text. Use it to read a search result in full.",
		inputSchema: z.object({ url: z.string() }),
		execute: async ({ url }) => {
			const page = await fetchPage(url, signal)
			return {
				...page,
				site: siteName(page.url),
				favicon: faviconUrl(page.url),
			}
		},
	}),

	generate_image: tool({
		description:
			"Generate an image from a text prompt and save it into the workspace. Needs a ChatGPT plan that includes image generation, or an OPENAI_API_KEY on the server.",
		inputSchema: z.object({
			prompt: z.string().describe("Detailed description of the image."),
			filename: z
				.string()
				.optional()
				.describe("Optional file name, saved under images/."),
			size: z.enum(["1024x1024", "1024x1536", "1536x1024", "auto"]).optional(),
		}),
		execute: async ({ prompt, filename, size }) =>
			await generateWorkspaceImage({
				sessionId,
				prompt,
				provider,
				filename,
				size: size && size !== "auto" ? size : undefined,
				signal,
			}),
	}),

	deep_research: tool({
		description:
			"Research a topic properly: runs several web searches, opens the pages they point at, and returns what each one actually says. Use this instead of `web_search` whenever the answer needs more than one source, or when the user asks you to research something. Always cite the source URLs in your reply.",
		inputSchema: z.object({
			topic: z.string().describe("What the user wants to know."),
			queries: z
				.array(z.string())
				.min(1)
				.max(6)
				.optional()
				.describe(
					"Search queries to run. Give 2-4 differently worded angles for good coverage; defaults to the topic itself.",
				),
			max_sources: z
				.number()
				.int()
				.min(1)
				.max(12)
				.optional()
				.describe("How many pages to open and read. Defaults to 6."),
		}),
		execute: async ({ topic, queries, max_sources }) =>
			await deepResearch({
				topic,
				queries,
				maxSources: max_sources,
				signal,
			}),
	}),

	extract_code: tool({
		description:
			"Pull the code samples out of a web page (docs, a blog post, a README) as usable blocks, instead of reading the whole page as prose.",
		inputSchema: z.object({
			url: z.string().describe("Page to extract code from."),
			save_to: z
				.string()
				.optional()
				.describe(
					"Optional workspace path. When set, the largest block is written there.",
				),
		}),
		execute: async ({ url, save_to }) => {
			const extracted = await extractCode(url, signal)
			let saved: { path: string; bytes: number } | undefined

			if (save_to?.trim()) {
				const largest = [...extracted.blocks].sort(
					(left, right) => right.code.length - left.code.length,
				)[0]
				if (largest) {
					const written = await writeWorkspaceFile(
						sessionId,
						save_to.replace(/^\/+/, ""),
						largest.code,
					)
					saved = { path: written.relative, bytes: written.bytes }
				}
			}

			return {
				url: extracted.url,
				title: extracted.title,
				site: siteName(extracted.url),
				favicon: faviconUrl(extracted.url),
				count: extracted.blocks.length,
				blocks: extracted.blocks.slice(0, 20),
				saved,
			}
		},
	}),

	install_package: tool({
		description:
			"Install one or more packages into the sandbox. Prefer this over a raw `run_command` install: it picks the right flags and gives installs a long enough timeout.",
		inputSchema: z.object({
			manager: z
				.enum(PACKAGE_MANAGERS)
				.describe("Package manager to use, e.g. npm or pip."),
			packages: z
				.array(z.string())
				.min(1)
				.max(30)
				.describe("Package names, optionally with a version, e.g. `zod@3.25`."),
			dev: z
				.boolean()
				.optional()
				.describe("Install as a dev dependency where the manager supports it."),
			cwd: z
				.string()
				.optional()
				.describe("Directory to install into, relative to the workspace root."),
		}),
		execute: async ({ manager, packages, dev, cwd }) => {
			const command = packageCommand(manager, "install", packages, dev)
			const result = await runCommand({
				sessionId,
				command,
				cwd,
				// Dependency trees are slow; a default timeout kills them halfway.
				timeoutMs: 600_000,
				signal,
			})
			const failed = result.timedOut || result.exitCode !== 0
			return {
				...result,
				manager,
				packages,
				failed,
				hint: failed
					? "The install failed. Read stderr: a missing manager needs a different `manager`, and a resolution error usually means the version does not exist."
					: undefined,
			}
		},
	}),

	uninstall_package: tool({
		description: "Remove one or more packages from the sandbox.",
		inputSchema: z.object({
			manager: z.enum(PACKAGE_MANAGERS),
			packages: z.array(z.string()).min(1).max(30),
			cwd: z.string().optional(),
		}),
		execute: async ({ manager, packages, cwd }) => {
			const command = packageCommand(manager, "uninstall", packages)
			const result = await runCommand({
				sessionId,
				command,
				cwd,
				timeoutMs: 300_000,
				signal,
			})
			return {
				...result,
				manager,
				packages,
				failed: result.timedOut || result.exitCode !== 0,
			}
		},
	}),

	run_file: tool({
		description:
			"Run a file in the workspace with the right interpreter for its extension (.py, .js, .ts, .sh, .rb, .go, .rs, …). Use it straight after `write_file` to check that what you wrote actually works.",
		inputSchema: z.object({
			path: z.string().describe("File to run, relative to the workspace root."),
			args: z.array(z.string()).optional().describe("Arguments for the program."),
			cwd: z.string().optional(),
			timeout_ms: z.number().int().min(1000).max(300000).optional(),
		}),
		execute: async ({ path, args, cwd, timeout_ms }) => {
			const command = runFileCommand(path, args ?? [])
			const result = await runCommand({
				sessionId,
				command,
				cwd,
				timeoutMs: timeout_ms,
				signal,
			})
			const failed = result.timedOut || result.exitCode !== 0
			return {
				...result,
				path,
				failed,
				hint: failed
					? "Non-zero exit. Open the file, fix the error the output names, and run it again."
					: undefined,
			}
		},
	}),
})

export type AgentTools = ReturnType<typeof createAgentTools>
