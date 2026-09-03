"use client"

import { useCallback, useEffect, useState } from "react"
import { PLANS, type PlanId } from "../lib/plans"
import type { UsageHistoryPoint, UsageStatus } from "../lib/usage"
import {
	ArrowRightIcon,
	BookIcon,
	BrandIcon,
	CheckIcon,
	CodeIcon,
	ImageIcon,
	LockIcon,
	SparkleIcon,
	SpinnerIcon,
	TerminalIcon,
	WarningIcon,
} from "./icons"
import { AccountAvatar, AccountEmail } from "./ClerkBits"
import { UsageChart } from "./UsageChart"

type UsageResponse = {
	plan: PlanId
	planName: string
	usage: UsageStatus
	history: UsageHistoryPoint[]
}

const PLAN_FEATURES: Array<{
	icon: (props: { className?: string }) => React.ReactNode
	label: string
	free: boolean
}> = [
	{ icon: SparkleIcon, label: "Every GPT model", free: false },
	{ icon: BookIcon, label: "Deep Research & Agent mode", free: false },
	{ icon: TerminalIcon, label: "Terminal & workspace", free: false },
	{ icon: ImageIcon, label: "Unlimited image generation", free: false },
	{ icon: CodeIcon, label: "Cornia Code on GitHub", free: false },
	{ icon: CheckIcon, label: "Reasoning control", free: false },
]

const untilReset = (resetsAt: number | null): string => {
	if (!resetsAt) {
		return "—"
	}
	const minutes = Math.max(Math.round((resetsAt - Date.now()) / 60_000), 0)
	if (minutes === 0) {
		return "now"
	}
	if (minutes < 60) {
		return `${minutes}m`
	}
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** One number, said plainly. */
function Stat({
	label,
	value,
	hint,
	tone,
}: {
	label: string
	value: string
	hint?: string
	tone?: "warn"
}) {
	return (
		<div className={`statTile ${tone === "warn" ? "warn" : ""}`}>
			<span className="statLabel">{label}</span>
			<span className="statValue">{value}</span>
			{hint ? <span className="statHint">{hint}</span> : null}
		</div>
	)
}

/**
 * Your plan and what you have spent of it.
 *
 * The numbers here are read from the server, which is also what enforces them —
 * so what this page says is what the API will actually do.
 */
export function AccountPage() {
	const [data, setData] = useState<UsageResponse | undefined>(undefined)
	const [error, setError] = useState<string | undefined>(undefined)
	const [loading, setLoading] = useState(true)

	const load = useCallback(async () => {
		try {
			const response = await fetch("/agent-api/usage?days=14", {
				cache: "no-store",
			})
			if (!response.ok) {
				throw new Error(`Could not read your usage (HTTP ${response.status}).`)
			}
			setData((await response.json()) as UsageResponse)
			setError(undefined)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const usage = data?.usage
	const onMax = data?.plan === "max"
	const plan = onMax ? PLANS.max : PLANS.free

	return (
		<main className="accountPage">
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

			<section className="accountHeader">
				<div>
					<h1>Your account</h1>
					<p className="accountEmail">
						<AccountEmail />
					</p>
				</div>
				<span className={`planChip ${onMax ? "max" : ""}`}>
					{onMax ? <SparkleIcon className="icon xs" /> : null}
					{data?.planName ?? "Cornia Free"}
				</span>
			</section>

			{error ? (
				<div className="errorBanner" style={{ marginBottom: 20 }}>
					<WarningIcon className="icon sm" />
					<span>
						{error}{" "}
						<button onClick={() => void load()} type="button">
							Try again
						</button>
					</span>
				</div>
			) : null}

			{loading ? (
				<div className="accountLoading">
					<SpinnerIcon className="icon spin" />
					Reading your usage…
				</div>
			) : (
				<>
					<div className="statRow">
						<Stat
							hint={`of ${usage?.limit ?? plan.turnLimit}`}
							label="Messages left"
							tone={usage?.remaining === 0 ? "warn" : undefined}
							value={String(usage?.remaining ?? plan.turnLimit)}
						/>
						<Stat
							hint="rolling"
							label="Window"
							value={`${usage?.windowHours ?? plan.windowHours}h`}
						/>
						<Stat
							hint={usage?.resetsAt ? "until one comes back" : "nothing spent"}
							label="Next refill"
							value={untilReset(usage?.resetsAt ?? null)}
						/>
						<Stat
							hint="in this window"
							label="Used"
							value={String(usage?.used ?? 0)}
						/>
					</div>

					{usage ? (
						<div className="accountMeter">
							<div className="quotaBar">
								<div
									className={`quotaFill ${usage.remaining <= 2 ? "low" : ""}`}
									style={{
										width: `${Math.min(usage.used / Math.max(usage.limit, 1), 1) * 100}%`,
									}}
								/>
							</div>
							<span>
								{usage.used} of {usage.limit} used in the last{" "}
								{usage.windowHours} hours
							</span>
						</div>
					) : null}

					<UsageChart history={data?.history ?? []} />

					<section className="accountPlanCard">
						<div className="accountPlanBody">
							<h2>{onMax ? "You're on Cornia Max" : "Cornia Max"}</h2>
							<p>
								{onMax
									? `Every model, every tool, and ${PLANS.max.turnLimit} messages every ${PLANS.max.windowHours} hours.`
									: `Cornia Free gives you ${PLANS.free.turnLimit} messages a day on GPT-5.6 Luna. Max is 20× that, plus everything below.`}
							</p>
							<ul className="accountFeatureList">
								{PLAN_FEATURES.map((feature) => (
									<li className={onMax ? "on" : "off"} key={feature.label}>
										{onMax ? (
											<CheckIcon className="icon sm" />
										) : (
											<LockIcon className="icon sm" />
										)}
										{feature.label}
									</li>
								))}
							</ul>
						</div>
						{onMax ? null : (
							<a className="authSubmit accountUpgrade" href="/max">
								<ArrowRightIcon className="icon sm" />
								Upgrade — ${PLANS.max.priceUsd}/month
							</a>
						)}
					</section>
				</>
			)}
		</main>
	)
}
