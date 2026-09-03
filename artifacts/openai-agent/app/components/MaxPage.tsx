"use client"

import { PricingTable, Show, UserButton } from "@clerk/nextjs"
import { CheckoutButton } from "@clerk/nextjs/experimental"
import { useState } from "react"
import { clerkEnabled } from "../lib/clerk"
import { MAX_PLAN_ID, PLANS } from "../lib/plans"
import {
	ArrowRightIcon,
	BookIcon,
	BrandIcon,
	CheckIcon,
	CodeIcon,
	FolderIcon,
	GlobeIcon,
	ImageIcon,
	LockIcon,
	PackageIcon,
	SparkleIcon,
	TerminalIcon,
} from "./icons"

const FEATURES: Array<{
	icon: (props: { className?: string }) => React.ReactNode
	title: string
	body: string
}> = [
	{
		icon: SparkleIcon,
		title: "Every GPT model",
		body: "The whole list your ChatGPT account can see — GPT-5.6 Sol, Terra and Luna, the Codex models, the 4-series and the o-series. Cornia Free runs on GPT-5.6 Luna alone.",
	},
	{
		icon: CheckIcon,
		title: "20× the usage",
		body: `${PLANS.max.turnLimit} messages every ${PLANS.max.windowHours} hours instead of ${PLANS.free.turnLimit} a day, and a live meter on your account page so you always know where you stand.`,
	},
	{
		icon: BookIcon,
		title: "Deep Research",
		body: "Several searches at once, every page opened and read, and a source list with each site's logo, its extract and a link you can check.",
	},
	{
		icon: TerminalIcon,
		title: "Terminal & Agent mode",
		body: "A real shell in your sandbox. The agent installs packages, runs your code and fixes its own failures — and you can type into the same session.",
	},
	{
		icon: FolderIcon,
		title: "Workspace",
		body: "Real files that persist: write, edit, run, clone a repository, upload up to 100 MB, and download the whole thing as a zip.",
	},
	{
		icon: ImageIcon,
		title: "Unlimited image generation",
		body: "Generate as many images as you like, saved into the workspace as files rather than stranded in the chat log.",
	},
	{
		icon: CodeIcon,
		title: "Cornia Code",
		body: "Point it at a GitHub repository and give it a task. It reads, edits, creates and deletes files, commits, pushes and comments — autonomously, in the background, resuming if it is interrupted.",
	},
	{
		icon: PackageIcon,
		title: "Split mode & model teams",
		body: "Put several GPT models on one project or one large file. They talk to each other and divide the work, like a small team on a hard problem.",
	},
	{
		icon: GlobeIcon,
		title: "MCP tools",
		body: "Call MCP tools, and register your own MCP servers so the agent can reach the systems you already use.",
	},
	{
		icon: BrandIcon,
		title: "Custom GPTs",
		body: "Name an agent, describe it, give it a logo, and save it. Yours to reuse in any chat.",
	},
	{
		icon: SparkleIcon,
		title: "Reasoning control",
		body: "Choose the effort per model, from low all the way to max. On Free, each model uses its own default.",
	},
	{
		icon: LockIcon,
		title: "Private by design",
		body: "Your chats stay in your browser and your ChatGPT credentials never leave it. The server only ever sees the conversation it is actively answering.",
	},
]

const COMPARISON: Array<{ label: string; free: string; max: string }> = [
	{ label: "Models", free: "GPT-5.6 Luna only", max: "Every GPT model" },
	{
		label: "Messages",
		free: `${PLANS.free.turnLimit} per day`,
		max: `${PLANS.max.turnLimit} per ${PLANS.max.windowHours} hours`,
	},
	{ label: "Reasoning effort", free: "Model default", max: "You choose" },
	{ label: "Workspace & files", free: "—", max: "Included" },
	{ label: "Terminal", free: "—", max: "Included" },
	{ label: "Deep Research", free: "—", max: "Included" },
	{ label: "Image generation", free: "—", max: "Unlimited" },
	{ label: "Cornia Code (GitHub)", free: "—", max: "Included" },
	{ label: "Split mode", free: "—", max: "Included" },
	{ label: "MCP tools", free: "—", max: "Included" },
	{ label: "Custom GPTs", free: "—", max: "Included" },
	{ label: "Uploads", free: "5 MB", max: "100 MB" },
]

/** The page that explains, and sells, Cornia Max. */
export function MaxPage() {
	const [done, setDone] = useState(false)

	return (
		<main className="landing maxPage">
			<div className="landingGlow" />

			<header className="landingNav">
				<a className="landingBrand" href="/">
					<BrandIcon className="icon" />
					Cornia
				</a>
				<div className="accountNavRight">
					<a className="landingNavLink" href="/">
						Back to chat
					</a>
					{clerkEnabled ? (
						<Show when="signed-in">
							<UserButton />
						</Show>
					) : null}
				</div>
			</header>

			<section className="maxHero">
				<span className="landingEyebrow">
					<SparkleIcon className="icon xs" />
					Cornia Max
				</span>
				<h1>
					Everything Cornia can do,
					<br />
					<span className="landingGradient">for ${PLANS.max.priceUsd} a month</span>
				</h1>
				<p className="landingLede maxLede">
					Every model on your account, a real terminal and workspace, research
					that reads whole pages, unlimited images, and an agent that works your
					GitHub repositories on its own.
				</p>

				{done ? (
					<div className="maxDone">
						<CheckIcon className="icon sm" />
						You're on Cornia Max. <a href="/">Start building →</a>
					</div>
				) : !clerkEnabled ? (
					// No billing configured: this build has no account layer, so
					// everything is already unlocked.
					<div className="maxDone">
						<CheckIcon className="icon sm" />
						This deployment runs without accounts — every feature is already
						available. <a href="/">Start building →</a>
					</div>
				) : (
					<>
						<Show when="signed-in">
							<CheckoutButton
								newSubscriptionRedirectUrl="/account"
								onSubscriptionComplete={() => setDone(true)}
								planId={MAX_PLAN_ID}
								planPeriod="month"
							>
								<button className="authSubmit maxCta" type="button">
									<ArrowRightIcon className="icon sm" />
									Upgrade to Cornia Max
								</button>
							</CheckoutButton>
						</Show>
						<Show when="signed-out">
							<a className="authSubmit maxCta" href="/">
								<ArrowRightIcon className="icon sm" />
								Create an account to upgrade
							</a>
						</Show>
					</>
				)}

				<p className="maxFinePrint">
					Billed monthly, cancel any time. Payment and billing are handled by
					Clerk — Cornia never sees your card.
				</p>
			</section>

			<section className="maxFeatures">
				{FEATURES.map((feature) => (
					<article className="landingFeature" key={feature.title}>
						<span className="landingFeatureIcon">
							<feature.icon className="icon sm" />
						</span>
						<h3>{feature.title}</h3>
						<p>{feature.body}</p>
					</article>
				))}
			</section>

			<section className="maxCompare">
				<h2>Free and Max, side by side</h2>
				<div className="maxTableWrap">
					<table className="maxTable">
						<thead>
							<tr>
								<th scope="col">&nbsp;</th>
								<th scope="col">Cornia Free</th>
								<th className="maxColumn" scope="col">
									Cornia Max
								</th>
							</tr>
						</thead>
						<tbody>
							{COMPARISON.map((row) => (
								<tr key={row.label}>
									<th scope="row">{row.label}</th>
									<td>{row.free}</td>
									<td className="maxColumn">{row.max}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			{/* Clerk's own table, for changing or cancelling an existing plan. */}
			{clerkEnabled ? (
				<Show when="signed-in">
					<section className="maxPricingTable">
						<h2>Manage your plan</h2>
						<PricingTable newSubscriptionRedirectUrl="/account" />
					</section>
				</Show>
			) : null}
		</main>
	)
}
