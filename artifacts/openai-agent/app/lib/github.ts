import { createSign } from "node:crypto"

const API = process.env.GITHUB_API_URL ?? "https://api.github.com"
const USER_AGENT = "cornia-ai"
const REQUEST_TIMEOUT_MS = 30_000

/**
 * The GitHub App this deployment acts as.
 *
 * Two ways in, in order of preference:
 *
 * 1. **App installation.** `GITHUB_APP_ID` plus `GITHUB_APP_PRIVATE_KEY` (the
 *    PEM downloaded from the app's settings — not the SHA256 fingerprint the
 *    settings page displays beside it). Cornia signs a short JWT, exchanges it
 *    for an installation token, and acts as the app.
 * 2. **A token.** `GITHUB_TOKEN`, either a personal access token or an
 *    installation token minted elsewhere. Simpler, and enough to get going.
 */
export const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "cornia-ai"
export const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`

const appId = process.env.GITHUB_APP_ID
const appPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n")
const staticToken = process.env.GITHUB_TOKEN

export const githubConfigured = Boolean(
	staticToken || (appId && appPrivateKey),
)

export class GitHubError extends Error {
	readonly status: number
	constructor(message: string, status: number) {
		super(message)
		this.name = "GitHubError"
		this.status = status
	}
}

const base64url = (input: Buffer | string): string =>
	Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

/** A ten-minute app JWT, signed with the app's private key. */
const appJwt = (): string => {
	if (!appId || !appPrivateKey) {
		throw new GitHubError("No GitHub App private key is configured.", 500)
	}
	const now = Math.floor(Date.now() / 1000)
	const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
	const payload = base64url(
		// Backdated by a minute so a slow clock on this machine cannot make the
		// token look like it was issued in the future.
		JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
	)
	const signer = createSign("RSA-SHA256")
	signer.update(`${header}.${payload}`)
	return `${header}.${payload}.${base64url(signer.sign(appPrivateKey))}`
}

type CachedToken = { token: string; expiresAt: number }
let installationToken: CachedToken | undefined

const request = async <T>(
	path: string,
	token: string,
	init: RequestInit = {},
): Promise<T> => {
	const response = await fetch(
		path.startsWith("http") ? path : `${API}${path}`,
		{
			...init,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"user-agent": USER_AGENT,
				"x-github-api-version": "2022-11-28",
				...(init.body ? { "content-type": "application/json" } : {}),
				...init.headers,
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		},
	)

	const body = await response.text()
	if (!response.ok) {
		let detail = body.slice(0, 300)
		try {
			const parsed = JSON.parse(body) as { message?: string }
			detail = parsed.message ?? detail
		} catch {}
		throw new GitHubError(`GitHub: ${detail}`, response.status)
	}
	return (body.length > 0 ? JSON.parse(body) : {}) as T
}

/**
 * A token good for the next few minutes. Installation tokens last an hour;
 * this refreshes with five minutes to spare so a long job never runs one out
 * mid-step.
 */
export const githubToken = async (): Promise<string> => {
	if (staticToken) {
		return staticToken
	}
	if (installationToken && Date.now() < installationToken.expiresAt) {
		return installationToken.token
	}
	if (!appId || !appPrivateKey) {
		throw new GitHubError(
			"GitHub is not connected. Set GITHUB_TOKEN, or GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.",
			503,
		)
	}

	const jwt = appJwt()
	const installations = await request<Array<{ id: number }>>(
		"/app/installations",
		jwt,
	)
	const configured = process.env.GITHUB_APP_INSTALLATION_ID
	const installationId = configured
		? Number(configured)
		: installations[0]?.id

	if (!installationId) {
		throw new GitHubError(
			`The GitHub App is not installed anywhere yet. Install it at ${GITHUB_APP_INSTALL_URL}.`,
			503,
		)
	}

	const minted = await request<{ token: string; expires_at: string }>(
		`/app/installations/${installationId}/access_tokens`,
		jwt,
		{ method: "POST" },
	)
	installationToken = {
		token: minted.token,
		expiresAt: Date.parse(minted.expires_at) - 5 * 60_000,
	}
	return minted.token
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> =>
	request<T>(path, await githubToken(), init)

export type Repo = {
	fullName: string
	name: string
	owner: string
	defaultBranch: string
	private: boolean
	description?: string
	updatedAt: string
}

type RepoPayload = {
	full_name: string
	name: string
	owner: { login: string }
	default_branch: string
	private: boolean
	description: string | null
	updated_at: string
}

const toRepo = (raw: RepoPayload): Repo => ({
	fullName: raw.full_name,
	name: raw.name,
	owner: raw.owner.login,
	defaultBranch: raw.default_branch,
	private: raw.private,
	description: raw.description ?? undefined,
	updatedAt: raw.updated_at,
})

/** Repositories this installation (or token) can reach, newest push first. */
export const listRepos = async (): Promise<Repo[]> => {
	// An installation token sees a different endpoint than a user token does.
	const path = staticToken
		? "/user/repos?per_page=100&sort=pushed"
		: "/installation/repositories?per_page=100"
	const payload = await call<
		RepoPayload[] | { repositories: RepoPayload[] }
	>(path)
	const repos = Array.isArray(payload) ? payload : payload.repositories
	return repos
		.map(toRepo)
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

const [ownerOf, repoOf] = [
	(fullName: string) => fullName.split("/")[0] ?? "",
	(fullName: string) => fullName.split("/")[1] ?? "",
]

export type TreeEntry = { path: string; type: "blob" | "tree"; size?: number }

/** The whole file list for a branch, in one call. */
export const listTree = async (
	fullName: string,
	ref: string,
): Promise<TreeEntry[]> => {
	const payload = await call<{
		tree: Array<{ path: string; type: string; size?: number }>
		truncated: boolean
	}>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
	)
	return payload.tree
		.filter((entry) => entry.type === "blob" || entry.type === "tree")
		.map((entry) => ({
			path: entry.path,
			type: entry.type === "tree" ? ("tree" as const) : ("blob" as const),
			size: entry.size,
		}))
}

export type RepoFile = { path: string; content: string; sha: string }

export const readRepoFile = async (
	fullName: string,
	filePath: string,
	ref?: string,
): Promise<RepoFile> => {
	const query = ref ? `?ref=${encodeURIComponent(ref)}` : ""
	const payload = await call<{
		content?: string
		encoding?: string
		sha: string
		type: string
	}>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/contents/${filePath
			.split("/")
			.map(encodeURIComponent)
			.join("/")}${query}`,
	)
	if (payload.type !== "file" || payload.content === undefined) {
		throw new GitHubError(`"${filePath}" is not a file.`, 400)
	}
	return {
		path: filePath,
		content: Buffer.from(payload.content, "base64").toString("utf8"),
		sha: payload.sha,
	}
}

/**
 * Creates or replaces a file, committing straight to `branch`.
 *
 * The existing sha is looked up first when none is supplied: GitHub rejects an
 * update that does not name the blob it is replacing, which is what stops two
 * concurrent writes silently clobbering one another.
 */
export const writeRepoFile = async ({
	fullName,
	path: filePath,
	content,
	message,
	branch,
	sha,
}: {
	fullName: string
	path: string
	content: string
	message: string
	branch: string
	sha?: string
}): Promise<{ commit: string; path: string }> => {
	let blobSha = sha
	if (!blobSha) {
		try {
			blobSha = (await readRepoFile(fullName, filePath, branch)).sha
		} catch (error) {
			// A 404 is the normal "this is a new file" case.
			if (!(error instanceof GitHubError) || error.status !== 404) {
				throw error
			}
		}
	}

	const payload = await call<{ commit: { sha: string } }>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/contents/${filePath
			.split("/")
			.map(encodeURIComponent)
			.join("/")}`,
		{
			method: "PUT",
			body: JSON.stringify({
				message,
				content: Buffer.from(content, "utf8").toString("base64"),
				branch,
				...(blobSha ? { sha: blobSha } : {}),
			}),
		},
	)
	return { commit: payload.commit.sha, path: filePath }
}

export const deleteRepoFile = async ({
	fullName,
	path: filePath,
	message,
	branch,
}: {
	fullName: string
	path: string
	message: string
	branch: string
}): Promise<{ commit: string }> => {
	const existing = await readRepoFile(fullName, filePath, branch)
	const payload = await call<{ commit: { sha: string } }>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/contents/${filePath
			.split("/")
			.map(encodeURIComponent)
			.join("/")}`,
		{
			method: "DELETE",
			body: JSON.stringify({ message, sha: existing.sha, branch }),
		},
	)
	return { commit: payload.commit.sha }
}

/** Branches off `from`, or reports the branch as already there. */
export const createBranch = async (
	fullName: string,
	branch: string,
	from: string,
): Promise<{ branch: string; created: boolean }> => {
	const owner = ownerOf(fullName)
	const repo = repoOf(fullName)
	try {
		await call(`/repos/${owner}/${repo}/git/ref/heads/${branch}`)
		return { branch, created: false }
	} catch (error) {
		if (!(error instanceof GitHubError) || error.status !== 404) {
			throw error
		}
	}

	const head = await call<{ object: { sha: string } }>(
		`/repos/${owner}/${repo}/git/ref/heads/${from}`,
	)
	await call(`/repos/${owner}/${repo}/git/refs`, {
		method: "POST",
		body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: head.object.sha }),
	})
	return { branch, created: true }
}

export const openPullRequest = async ({
	fullName,
	title,
	body,
	head,
	base,
}: {
	fullName: string
	title: string
	body: string
	head: string
	base: string
}): Promise<{ number: number; url: string }> => {
	const payload = await call<{ number: number; html_url: string }>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/pulls`,
		{ method: "POST", body: JSON.stringify({ title, body, head, base }) },
	)
	return { number: payload.number, url: payload.html_url }
}

export const commentOnIssue = async (
	fullName: string,
	issueNumber: number,
	body: string,
): Promise<{ url: string }> => {
	const payload = await call<{ html_url: string }>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/issues/${issueNumber}/comments`,
		{ method: "POST", body: JSON.stringify({ body }) },
	)
	return { url: payload.html_url }
}

/** Merges a pull request. Kept separate so it is easy to withhold. */
export const mergePullRequest = async (
	fullName: string,
	pullNumber: number,
	method: "merge" | "squash" | "rebase" = "squash",
): Promise<{ merged: boolean; sha?: string }> => {
	const payload = await call<{ merged: boolean; sha?: string }>(
		`/repos/${ownerOf(fullName)}/${repoOf(fullName)}/pulls/${pullNumber}/merge`,
		{ method: "PUT", body: JSON.stringify({ merge_method: method }) },
	)
	return payload
}
