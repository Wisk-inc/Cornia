import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Cornia Code jobs, on disk.
 *
 * A job is meant to outlive the request that started it and, if the server is
 * restarted mid-run, to be picked up again rather than lost — so every step is
 * written down as it happens, and the transcript is what a resumed run reads to
 * work out where it got to.
 */
const JOB_ROOT =
	process.env.CORNIA_JOB_ROOT ?? path.join(process.cwd(), ".cornia-jobs")

export type JobStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"

export type JobStep = {
	at: number
	kind: "note" | "tool" | "text" | "error"
	label: string
	detail?: string
}

export type CodeJob = {
	id: string
	userId: string
	repo: string
	branch: string
	baseBranch: string
	task: string
	model: string
	status: JobStatus
	steps: JobStep[]
	summary?: string
	error?: string
	createdAt: number
	updatedAt: number
	/** Bumped every time a runner picks the job up, including after a restart. */
	attempts: number
	/** Heartbeat, so a job abandoned by a dead process can be spotted. */
	heartbeatAt: number
}

/** Past this with no heartbeat, a "running" job is assumed to have been killed. */
export const STALE_AFTER_MS = 90_000

const jobPath = (id: string) => path.join(JOB_ROOT, `${id}.json`)

export const newJobId = (): string =>
	`job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const isJob = (value: unknown): value is CodeJob =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as CodeJob).id === "string" &&
	typeof (value as CodeJob).repo === "string"

export const readJob = async (id: string): Promise<CodeJob | undefined> => {
	try {
		const parsed: unknown = JSON.parse(await readFile(jobPath(id), "utf8"))
		return isJob(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

export const writeJob = async (job: CodeJob): Promise<void> => {
	await mkdir(JOB_ROOT, { recursive: true })
	const target = jobPath(job.id)
	// Write-then-rename: a crash part-way through must not leave a job file that
	// parses as something other than what it was.
	const temporary = `${target}.${process.pid}.tmp`
	await writeFile(temporary, JSON.stringify(job), "utf8")
	await rename(temporary, target)
}

export const listJobs = async (userId: string): Promise<CodeJob[]> => {
	try {
		const names = await readdir(JOB_ROOT)
		const jobs = await Promise.all(
			names
				.filter((name) => name.endsWith(".json"))
				.map((name) => readJob(name.replace(/\.json$/, ""))),
		)
		return jobs
			.filter((job): job is CodeJob => job !== undefined)
			.filter((job) => job.userId === userId)
			.sort((left, right) => right.createdAt - left.createdAt)
			.slice(0, 50)
	} catch {
		return []
	}
}

/** Appends a step and persists it, so progress is visible while it happens. */
export const appendStep = async (
	id: string,
	step: Omit<JobStep, "at">,
): Promise<CodeJob | undefined> => {
	const job = await readJob(id)
	if (!job) {
		return undefined
	}
	const updated: CodeJob = {
		...job,
		steps: [...job.steps, { ...step, at: Date.now() }].slice(-200),
		updatedAt: Date.now(),
		heartbeatAt: Date.now(),
	}
	await writeJob(updated)
	return updated
}

export const updateJob = async (
	id: string,
	changes: Partial<CodeJob>,
): Promise<CodeJob | undefined> => {
	const job = await readJob(id)
	if (!job) {
		return undefined
	}
	const updated: CodeJob = { ...job, ...changes, updatedAt: Date.now() }
	await writeJob(updated)
	return updated
}

/**
 * Jobs that claim to be running but have stopped reporting in.
 *
 * The runner heartbeats on every step; a process that is killed stops doing so,
 * and the next request that looks at the job hands it back to a fresh runner.
 * That is what "it can continue by itself" rests on.
 */
export const staleJobs = async (userId: string): Promise<CodeJob[]> => {
	const cutoff = Date.now() - STALE_AFTER_MS
	return (await listJobs(userId)).filter(
		(job) =>
			(job.status === "running" || job.status === "queued") &&
			job.heartbeatAt < cutoff,
	)
}
