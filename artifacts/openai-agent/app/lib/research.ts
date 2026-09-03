import { assertFetchableUrl, fetchPage, webSearch } from "./search"

const MAX_QUERIES = 6
const MAX_SOURCES = 12
const DEFAULT_SOURCES = 6
const DEFAULT_EXTRACT_CHARS = 2_400
// Pages are fetched a few at a time: enough to be quick, few enough that a slow
// site cannot stall the whole report.
const FETCH_CONCURRENCY = 4

export type ResearchSource = {
	url: string
	title: string
	site: string
	favicon: string
	snippet: string
	extract: string
	words: number
	read: boolean
	error?: string
}

export type ResearchReport = {
	topic: string
	queries: string[]
	provider: string
	sources: ResearchSource[]
	read: number
	failed: number
}

/** `https://react.dev/learn` -> `react.dev`. */
export const siteName = (url: string): string => {
	try {
		return new URL(url).hostname.replace(/^www\./, "")
	} catch {
		return url
	}
}

/**
 * Served from this app rather than linking a third party directly, so the
 * browser never announces to an icon service which pages the agent has read.
 */
export const faviconUrl = (url: string): string =>
	`/agent-api/favicon?domain=${encodeURIComponent(siteName(url))}`

const firstParagraphs = (text: string, limit: number): string => {
	const cleaned = text.replace(/\n{3,}/g, "\n\n").trim()
	return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}…` : cleaned
}

const mapWithConcurrency = async <Input, Output>(
	items: Input[],
	limit: number,
	worker: (item: Input) => Promise<Output>,
): Promise<Output[]> => {
	const results: Output[] = new Array(items.length)
	let next = 0
	const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
		(async () => {
			while (next < items.length) {
				const index = next
				next += 1
				results[index] = await worker(items[index] as Input)
			}
		})(),
	)
	await Promise.all(runners)
	return results
}

/**
 * Runs several searches, then actually reads the pages they point at.
 *
 * A search result's snippet is two sentences chosen by the search engine; the
 * page itself is the source. Reading them here means the model answers from the
 * documents, and the UI can show which sites the answer came from.
 */
export const deepResearch = async ({
	topic,
	queries,
	maxSources = DEFAULT_SOURCES,
	extractChars = DEFAULT_EXTRACT_CHARS,
	signal,
}: {
	topic: string
	queries?: string[]
	maxSources?: number
	extractChars?: number
	signal?: AbortSignal
}): Promise<ResearchReport> => {
	const searches = (
		queries && queries.length > 0 ? queries : [topic]
	).slice(0, MAX_QUERIES)
	const limit = Math.min(Math.max(maxSources, 1), MAX_SOURCES)

	const seen = new Set<string>()
	const candidates: Array<{ url: string; title: string; snippet: string }> = []
	let provider = "none"

	for (const query of searches) {
		if (candidates.length >= limit * 2) {
			break
		}
		try {
			const response = await webSearch(query, Math.min(limit, 10), signal)
			provider = response.provider
			for (const result of response.results) {
				const key = result.url.replace(/[#?].*$/, "")
				if (seen.has(key)) {
					continue
				}
				seen.add(key)
				candidates.push(result)
			}
		} catch {
			// One failed query should not sink the whole report.
		}
	}

	if (candidates.length === 0) {
		throw new Error(
			`No search results for ${searches.map((query) => `"${query}"`).join(", ")}. Try a different wording, or set BRAVE_SEARCH_API_KEY / TAVILY_API_KEY for a more reliable backend.`,
		)
	}

	const sources = await mapWithConcurrency(
		candidates.slice(0, limit),
		FETCH_CONCURRENCY,
		async (candidate): Promise<ResearchSource> => {
			const base: ResearchSource = {
				url: candidate.url,
				title: candidate.title || siteName(candidate.url),
				site: siteName(candidate.url),
				favicon: faviconUrl(candidate.url),
				snippet: candidate.snippet,
				extract: "",
				words: 0,
				read: false,
			}
			try {
				assertFetchableUrl(candidate.url)
				const page = await fetchPage(candidate.url, signal)
				return {
					...base,
					title: page.title || base.title,
					extract: firstParagraphs(page.text, extractChars),
					words: page.text.trim().split(/\s+/).filter(Boolean).length,
					read: true,
				}
			} catch (error) {
				return {
					...base,
					// The snippet still carries something usable when the page itself
					// blocks scripted readers.
					extract: candidate.snippet,
					error: error instanceof Error ? error.message : String(error),
				}
			}
		},
	)

	return {
		topic,
		queries: searches,
		provider,
		sources,
		read: sources.filter((source) => source.read).length,
		failed: sources.filter((source) => !source.read).length,
	}
}

export type ExtractedCode = {
	language?: string
	code: string
	lines: number
}

const HTML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&apos;": "'",
	"&nbsp;": " ",
}

const decode = (value: string): string =>
	value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)
		.replace(
			/&(amp|lt|gt|quot|#39|apos|nbsp);/g,
			(entity) => HTML_ENTITIES[entity] ?? entity,
		)

const languageFromClass = (attributes: string): string | undefined =>
	attributes.match(
		/class=["'][^"']*(?:language|lang|highlight)[-_]([a-z0-9+#]+)/i,
	)?.[1]

/**
 * Pulls the code out of a page: `<pre>` blocks first, then Markdown fences for
 * raw `.md` files and READMEs served as text.
 */
export const extractCode = async (
	rawUrl: string,
	signal?: AbortSignal,
): Promise<{ url: string; title: string; blocks: ExtractedCode[] }> => {
	const url = assertFetchableUrl(rawUrl)
	const response = await fetch(url, {
		headers: {
			accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
		},
		redirect: "follow",
		signal,
	})
	if (!response.ok) {
		throw new Error(`Request failed with status ${response.status}.`)
	}

	const body = await response.text()
	const title = decode(
		body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
	)
		.replace(/\s+/g, " ")
		.trim()

	const blocks: ExtractedCode[] = []

	for (const match of body.matchAll(
		/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi,
	)) {
		const inner = match[2] ?? ""
		const codeMatch = inner.match(/<code\b([^>]*)>([\s\S]*?)<\/code>/i)
		const attributes = `${match[1] ?? ""} ${codeMatch?.[1] ?? ""}`
		const code = decode((codeMatch?.[2] ?? inner).replace(/<[^>]*>/g, ""))
			.replace(/\r\n/g, "\n")
			.trim()
		if (code.length > 0) {
			blocks.push({
				language: languageFromClass(attributes),
				code,
				lines: code.split("\n").length,
			})
		}
	}

	if (blocks.length === 0) {
		for (const match of body.matchAll(
			/```([a-z0-9+#-]*)\n([\s\S]*?)```/gi,
		)) {
			const code = (match[2] ?? "").trim()
			if (code.length > 0) {
				blocks.push({
					language: match[1] || undefined,
					code,
					lines: code.split("\n").length,
				})
			}
		}
	}

	if (blocks.length === 0) {
		throw new Error(
			"No code blocks were found on that page. Use `fetch_url` to read it as text instead.",
		)
	}

	return { url: url.toString(), title: title || url.hostname, blocks }
}
