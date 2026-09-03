"use client"

import { type PlanFeature, lockReason, PLANS } from "../lib/plans"
import type { UsageStatus } from "../lib/usage"
import {
	ArrowRightIcon,
	BookIcon,
	CheckIcon,
	CloseIcon,
	CodeIcon,
	ImageIcon,
	SparkleIcon,
	TerminalIcon,
} from "./icons"

const HIGHLIGHTS = [
	{ icon: SparkleIcon, label: "Every GPT model on your account" },
	{ icon: TerminalIcon, label: "Sandbox terminal and workspace" },
	{ icon: BookIcon, label: "Deep Research and Agent mode" },
	{ icon: ImageIcon, label: "Unlimited image generation" },
	{ icon: CodeIcon, label: "Cornia Code on your GitHub repos" },
	{ icon: CheckIcon, label: "20× the usage, and reasoning control" },
]

const relativeReset = (resetsAt: number | null): string => {
	if (!resetsAt) {
		return "shortly"
	}
	const minutes = Math.max(Math.round((resetsAt - Date.now()) / 60_000), 0)
	if (minutes < 60) {
		return `in ${minutes} minute${minutes === 1 ? "" : "s"}`
	}
	const hours = Math.round(minutes / 60)
	return `in about ${hours} hour${hours === 1 ? "" : "s"}`
}

/**
 * The one place an upgrade is explained. Shown when a locked control is used
 * and when the allowance runs out — the two moments the difference between the
 * plans is actually felt.
 */
export function UpgradeDialog({
	feature,
	usage,
	onClose,
}: {
	/** Which lock was hit, if a specific one was. */
	feature?: PlanFeature
	/** Present when the dialog opened because the allowance ran out. */
	usage?: UsageStatus
	onClose: () => void
}) {
	const exhausted = usage?.exhausted === true

	return (
		<div className="overlay">
			<button
				aria-label="Close"
				className="dialogScrim"
				onClick={onClose}
				type="button"
			/>
			<div className="dialog upgradeDialog" role="dialog">
				<button
					aria-label="Close"
					className="iconButton upgradeClose"
					onClick={onClose}
					type="button"
				>
					<CloseIcon className="icon sm" />
				</button>

				<span className="upgradeBadge">
					<SparkleIcon className="icon xs" />
					Cornia Max
				</span>

				<h2>
					{exhausted
						? "You've used this window's messages"
						: "Unlock this with Cornia Max"}
				</h2>

				<p className="upgradeLede">
					{exhausted
						? `Cornia Free includes ${usage?.limit ?? PLANS.free.turnLimit} messages every ${usage?.windowHours ?? PLANS.free.windowHours} hours. Your next one is back ${relativeReset(usage?.resetsAt ?? null)} — or upgrade for 20× the usage.`
						: feature
							? lockReason(feature)
							: "Cornia Max opens up every model and every tool."}
				</p>

				<ul className="upgradeList">
					{HIGHLIGHTS.map((item) => (
						<li key={item.label}>
							<item.icon className="icon sm" />
							{item.label}
						</li>
					))}
				</ul>

				<a className="authSubmit upgradeCta" href="/max">
					<ArrowRightIcon className="icon sm" />
					See Cornia Max — ${PLANS.max.priceUsd}/month
				</a>

				<button className="upgradeDismiss" onClick={onClose} type="button">
					Not now
				</button>
			</div>
		</div>
	)
}
