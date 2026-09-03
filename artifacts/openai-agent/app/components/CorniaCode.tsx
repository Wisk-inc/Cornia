"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEntitlements } from "../hooks/useEntitlements"
import { useModels } from "../hooks/useModels"
import type { CodeJob } from "../lib/codeJobs"
import type { Repo } from "../lib/github"
import { AccountAvatar } from "./ClerkBits"
import {
	ArrowRightIcon,
	BrandIcon,
	CheckIcon,
	ChevronDownIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CodeIcon,
	LinkIcon,
	LockIcon,
	SparkleIcon,
	SpinnerIcon,
	StopIcon,
	TerminalIcon,
	WarningIcon,
} from "./icons"

const POLL_MS = 4_000

const STATUS_LABEL: Record<CodeJob["status"], string> = {
	queued: "Queued",
	running: "Working",
	completed: "Done",
	failed: "Failed",
	cancelled: "Cancelled",
}

const clock = (at: number): string =>
	new Date(at).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})

function JobCard({
	job,
	onCancel,
}: {
	job: CodeJob
	onCancel: (id: string) => void
}) {
	const [open, setOpen] = useState(job.status === "running")
	const live = job.status === "running" || job.status === "queued"

	return (
		<article className={`jobCard ${job.status}`}>
			<button
				className="jobHead"
				onClick={() => setOpen((current) => !current)}
				type="button"
			>
				<span className="jobStatusIcon">
					{live ? (
						<SpinnerIcon className="icon sm spin" />
					) : job.status === "completed" ? (
						<CircleCheckIcon className="icon sm" />
					) : (
						<WarningIcon className="icon sm" />
					)}
				</span>
				<span className="jobHeadText">
					<strong>{job.task}</strong>
					<span className="jobMeta">
						{job.repo} · {job.branch} · {job.model}
						{job.attempts > 1 ? ` · resumed ${job.attempts - 1}×` : ""}
					</span>
				</span>
				<span className={`jobBadge ${job.status}`}>
					{STATUS_LABEL[job.status]}
				</span>
				<ChevronDownIcon className={`icon sm chevron ${open ? "up" : ""}`} />
			</button>

			{open ? (
				<div className="jobBody">
					<ol className="jobSteps">
						{job.steps.map((step, index) => (
							<li
								className={`jobStep ${step.kind}`}
								key={`${step.at}-${index}`}
							>
								<span className="jobStepIcon">
									{step.kind === "tool" ? (
										<CodeIcon className="icon xs" />
									) : step.kind === "error" ? (
										<WarningIcon className="icon xs" />
									) : (
										<CircleDotIcon className="icon xs" />
									)}
								</span>
								<span className="jobStepBody">
									<strong>{step.label}</strong>
									{step.detail ? <span>{step.detail}</span> : null}
								</span>
								<time>{clock(step.at)}</time>
							</li>
						))}
						{job.steps.length === 0 ? (
							<li className="jobStep">
								<span className="jobStepBody">
									<span>Starting…</span>
								</span>
							</li>
						) : null}
					</ol>

					{job.summary ? (
						<div className="jobSummary">
							<CheckIcon className="icon sm" />
							<p>{job.summary}</p>
						</div>
					) : null}

					{job.error ? (
						<div className="errorBanner">
							<WarningIcon className="icon sm" />
							<span>{job.error}</span>
						</div>
					) : null}

					{live ? (
						<button
							className="jobCancel"
							onClick={() => onCancel(job.id)}
							type="button"
						>
							<StopIcon className="icon xs" />
							Stop this task
						</button>
					) : null}
				</div>
			) : null}
		</article>
	)
}

/**
 * Cornia Code.
 *
 * Pick a repository, describe a task, and leave. The job runs on the server,
 * writes down every step as it goes, and picks itself back up if the process it
 * was running in goes away — so closing this tab does not stop the work.
 */
export function CorniaCode() {
	const entitlements = useEntitlements(true)
	const models = useModels(true)

	const [repos, setRepos] = useState<Repo[]>([])
	const [repo, setRepo] = useState("")
	const [task, setTask] = useState("")
	const [model, setModel] = useState<string | undefined>(undefined)
	const [jobs, setJobs] = useState<CodeJob[]>([])
	const [error, setError] = useState<string | undefined>(undefined)
	const [installUrl, setInstallUrl] = useState<string | undefined>(undefined)
	const [starting, setStarting] = useState(false)
	const [loadingRepos, setLoadingRepos] = useState(true)
	const pollRef = useRef<number | undefined>(undefined)

	const allowed = entitlements.can("corniaCode")

	const usableModels = useMemo(
		() => models.models.filter((item) => entitlements.allowsModel(item.id)),
		[models.models, entitlements],
	)

	useEffect(() => {
		if (!model && usableModels.length > 0) {
			setModel(models.defaultModel ?? usableModels[0]?.id)
		}
	}, [model, models.defaultModel, usableModels])

	const loadRepos = useCallback(async () => {
		setLoadingRepos(true)
		try {
			const response = await fetch("/agent-api/code/repos", {
				cache: "no-store",
			})
			const payload = (await response.json()) as {
				repos?: Repo[]
				error?: string
				installUrl?: string
				needsSetup?: boolean
			}
			if (!response.ok) {
				setInstallUrl(payload.needsSetup ? payload.installUrl : undefined)
				throw new Error(payload.error ?? "Could not read your repositories.")
			}
			setRepos(payload.repos ?? [])
			setRepo((current) => current || (payload.repos?.[0]?.fullName ?? ""))
			setError(undefined)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		} finally {
			setLoadingRepos(false)
		}
	}, [])

	const loadJobs = useCallback(async () => {
		try {
			const response = await fetch("/agent-api/code/jobs", {
				cache: "no-store",
			})
			if (!response.ok) {
				return
			}
			const payload = (await response.json()) as { jobs?: CodeJob[] }
			setJobs(payload.jobs ?? [])
		} catch {
			// A missed poll is not worth surfacing; the next one will land.
		}
	}, [])

	useEffect(() => {
		if (!allowed) {
			return
		}
		void loadRepos()
		void loadJobs()
	}, [allowed, loadRepos, loadJobs])

	// Polling doubles as the resume trigger: the listing endpoint hands any
	// abandoned job back to a runner as it answers.
	useEffect(() => {
		if (!allowed) {
			return
		}
		pollRef.current = window.setInterval(() => void loadJobs(), POLL_MS)
		return () => window.clearInterval(pollRef.current)
	}, [allowed, loadJobs])

	const start = useCallback(async () => {
		const trimmed = task.trim()
		if (!repo || trimmed.length === 0 || starting) {
			return
		}
		setStarting(true)
		setError(undefined)
		try {
			const selected = repos.find((item) => item.fullName === repo)
			const response = await fetch("/agent-api/code/jobs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					repo,
					task: trimmed,
					model,
					baseBranch: selected?.defaultBranch ?? "main",
				}),
			})
			const payload = (await response.json()) as {
				job?: CodeJob
				error?: string
			}
			if (!response.ok || !payload.job) {
				throw new Error(payload.error ?? "Could not start the task.")
			}
			setJobs((current) => [payload.job as CodeJob, ...current])
			setTask("")
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		} finally {
			setStarting(false)
		}
	}, [model, repo, repos, starting, task])

	const cancel = useCallback(
		async (id: string) => {
			await fetch(`/agent-api/code/jobs/${id}`, { method: "DELETE" })
			void loadJobs()
		},
		[loadJobs],
	)

	if (entitlements.loaded && !allowed) {
		return (
			<main className="codePage">
				<header className="accountNav">
					<a className="landingBrand" href="/">
						<BrandIcon className="icon" />
						Cornia
					</a>
					<a className="landingNavLink" href="/">
						Back to chat
					</a>
				</header>
				<section className="codeLocked">
					<span className="upgradeBadge">
						<LockIcon className="icon xs" />
						Cornia Max
					</span>
					<h1>Cornia Code</h1>
					<p>
						Point Cornia at one of your GitHub repositories and give it a task.
						It reads the code, makes the change, commits, pushes and opens a
						pull request — on its own, in the background, picking itself back up
						if it is interrupted.
					</p>
					<a className="authSubmit maxCta" href="/max">
						<ArrowRightIcon className="icon sm" />
						Unlock with Cornia Max
					</a>
				</section>
			</main>
		)
	}

	return (
		<main className="codePage">
			<header className="accountNav">
				<a className="landingBrand" href="/">
					<BrandIcon className="icon" />
					Cornia
				</a>
				<div className="accountNavRight">
					<a className="landingNavLink" href="/">
						Back to chat
					</a>
					<AccountAvatar />
				</div>
			</header>

			<section className="codeHeader">
				<div>
					<h1>
						<CodeIcon className="icon" />
						Cornia Code
					</h1>
					<p>
						Give it a repository and a task. It works in the background — you can
						close this tab.
					</p>
				</div>
			</section>

			{installUrl ? (
				<div className="codeSetup">
					<TerminalIcon className="icon sm" />
					<div>
						<strong>Connect GitHub</strong>
						<p>
							Install the Cornia AI GitHub App on the repositories you want it
							to work in, then reload this page.
						</p>
					</div>
					<a
						className="authSubmit"
						href={installUrl}
						rel="noreferrer noopener"
						target="_blank"
					>
						<LinkIcon className="icon sm" />
						Install the app
					</a>
				</div>
			) : null}

			<section className="codeComposer">
				<div className="codeRow">
					<label className="codeField">
						<span>Repository</span>
						<select
							disabled={loadingRepos || repos.length === 0}
							onChange={(event) => setRepo(event.target.value)}
							value={repo}
						>
							{repos.length === 0 ? (
								<option value="">
									{loadingRepos ? "Loading…" : "No repositories"}
								</option>
							) : null}
							{repos.map((item) => (
								<option key={item.fullName} value={item.fullName}>
									{item.fullName}
									{item.private ? " (private)" : ""}
								</option>
							))}
						</select>
					</label>

					<label className="codeField">
						<span>Model</span>
						<select
							onChange={(event) => setModel(event.target.value)}
							value={model ?? ""}
						>
							{usableModels.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
					</label>
				</div>

				<textarea
					className="codeTask"
					onChange={(event) => setTask(event.target.value)}
					placeholder="Describe the task — e.g. “Add a --json flag to the export command, update the README, and open a PR.”"
					rows={4}
					value={task}
				/>

				<div className="codeActions">
					<span className="codeHint">
						<SparkleIcon className="icon xs" />
						Runs on a new branch and opens a pull request. Nothing is committed
						to {repos.find((item) => item.fullName === repo)?.defaultBranch ??
							"the default branch"}
						.
					</span>
					<button
						className="authSubmit codeStart"
						disabled={starting || !repo || task.trim().length === 0}
						onClick={() => void start()}
						type="button"
					>
						{starting ? (
							<SpinnerIcon className="icon sm spin" />
						) : (
							<ArrowRightIcon className="icon sm" />
						)}
						Start task
					</button>
				</div>

				{error ? (
					<div className="errorBanner">
						<WarningIcon className="icon sm" />
						<span>{error}</span>
					</div>
				) : null}
			</section>

			<section className="codeJobs">
				<h2>Tasks</h2>
				{jobs.length === 0 ? (
					<p className="filesEmpty">
						Nothing yet. Started tasks appear here with every step they take.
					</p>
				) : (
					jobs.map((job) => (
						<JobCard job={job} key={job.id} onCancel={(id) => void cancel(id)} />
					))
				)}
			</section>
		</main>
	)
}
