"use client"

import { useEffect, useState } from "react"
import {
	BrandIcon,
	CheckIcon,
	FolderIcon,
	GlobeIcon,
	ImageIcon,
	LockIcon,
	SparkleIcon,
	SpinnerIcon,
	TerminalIcon,
	WarningIcon,
} from "./icons"

const FEATURES = [
	{ icon: TerminalIcon, label: "Sandbox terminal" },
	{ icon: FolderIcon, label: "Reads and writes real files" },
	{ icon: GlobeIcon, label: "Web search" },
	{ icon: ImageIcon, label: "Image generation" },
	{ icon: SparkleIcon, label: "Every model on your account" },
]

const STUCK_AFTER_MS = 12_000

const storeName = (installUrl: string): string =>
	installUrl.includes("addons.mozilla.org")
		? "Firefox Add-ons"
		: "the Chrome Web Store"

export function SignIn({
	status,
	error,
	installUrl,
	onSignIn,
	onCancel,
}: {
	status: string
	error?: string
	installUrl?: string
	onSignIn: () => Promise<void> | void
	onCancel: () => Promise<void> | void
}) {
	const busy =
		status === "checking" || status === "starting" || status === "redirecting"
	const [stuck, setStuck] = useState(false)
	const [embedded, setEmbedded] = useState(false)
	const [tabOpenFailed, setTabOpenFailed] = useState(false)
	const [tabUrl, setTabUrl] = useState("")
	const [checkingExtension, setCheckingExtension] = useState(false)
	const [extensionMessage, setExtensionMessage] = useState("")

	useEffect(() => {
		setEmbedded(window.top !== window.self)
		setTabUrl(window.location.href)
	}, [])

	// A hosted app that never comes back should say so instead of spinning.
	useEffect(() => {
		if (!busy) {
			setStuck(false)
			return
		}
		const timer = window.setTimeout(() => setStuck(true), STUCK_AFTER_MS)
		return () => window.clearTimeout(timer)
	}, [busy])

	useEffect(() => {
		if (!checkingExtension) {
			return
		}
		const timer = window.setTimeout(() => {
			setCheckingExtension(false)
			setExtensionMessage(
				"The extension was not detected in this browser tab. Make sure it is enabled for this site, then try again in a real browser tab.",
			)
		}, 2_500)
		return () => window.clearTimeout(timer)
	}, [checkingExtension])

	const handleSignIn = async () => {
		if (embedded) {
			const tab = window.open(tabUrl || window.location.href, "_blank")
			if (!tab) {
				setTabOpenFailed(true)
				return
			}
			tab.opener = null
			setTabOpenFailed(false)
			return
		}
		if (stuck) {
			await onCancel()
			setStuck(false)
		}
		setTabOpenFailed(false)
		onSignIn()
	}

	const handleExtensionContinue = () => {
		setCheckingExtension(true)
		setExtensionMessage("")
		void onSignIn()
	}

	// Hosted apps (Replit, Vercel, anything that is not localhost) complete the
	// OAuth handoff through the Sign in with ChatGPT extension.
	if (status === "needs-extension" && installUrl) {
		return (
			<main className="signIn">
				<BrandIcon className="icon" />
				<h1>One more step</h1>
				<p>
					This app is hosted, so the ChatGPT sign-in handoff goes through the
					open-source <strong>Sign in with ChatGPT</strong> extension. Install
					it once from {storeName(installUrl)}, then come back and continue.
				</p>

				<div
					style={{
						display: "flex",
						gap: 10,
						flexWrap: "wrap",
						justifyContent: "center",
						marginTop: 10,
					}}
				>
					<a
						className="buttonPrimary"
						href={installUrl}
						rel="noreferrer noopener"
						target="_blank"
					>
						Install the extension
					</a>
					{embedded && tabUrl ? (
						<a
							className="buttonPrimary"
							href={tabUrl}
							rel="noreferrer noopener"
							target="_blank"
						>
							<CheckIcon className="icon sm" />
							Continue in a new tab
						</a>
					) : (
						<button
							className="buttonGhost"
							disabled={checkingExtension}
							onClick={handleExtensionContinue}
							type="button"
						>
							{checkingExtension ? (
								<SpinnerIcon className="icon sm spin" />
							) : (
								<CheckIcon className="icon sm" />
							)}
							{checkingExtension
								? "Checking extension…"
								: "I've installed it — continue"}
						</button>
					)}
				</div>

				{extensionMessage ? (
					<div className="errorBanner" style={{ maxWidth: 460, marginTop: 14 }}>
						<WarningIcon className="icon sm" />
						<span>{extensionMessage}</span>
					</div>
				) : null}

				<button
					className="buttonGhost"
					onClick={onCancel}
					style={{ border: "none", marginTop: 4 }}
					type="button"
				>
					Cancel
				</button>

				<span className="signInNote">
					<LockIcon className="icon xs" />
					Running it locally with `bun run dev` needs no extension.
				</span>
			</main>
		)
	}

	return (
		<main className="signIn">
			<BrandIcon className="icon" />
			<h1>Your own coding agent</h1>
			<p>
				A ChatGPT-style workspace that plans, writes code, runs it in a sandbox
				and searches the web — powered by your own ChatGPT account, with no API
				key.
			</p>

			<div className="featureRow">
				{FEATURES.map((feature) => (
					<span className="featureChip" key={feature.label}>
						<feature.icon className="icon sm" />
						{feature.label}
					</span>
				))}
			</div>

			<button
				className="buttonPrimary"
				disabled={busy && !stuck}
				onClick={() => void handleSignIn()}
				style={{ marginTop: 18, height: 48, padding: "0 22px", fontSize: 16 }}
				type="button"
			>
				{busy && !stuck ? (
					<SpinnerIcon className="icon sm spin" />
				) : (
					<BrandIcon className="icon sm" />
				)}
				{stuck ? "Try sign-in again" : busy ? "Connecting…" : "Sign in with ChatGPT"}
			</button>

			{embedded ? (
				<div className="errorBanner" style={{ maxWidth: 460, marginTop: 14 }}>
					<WarningIcon className="icon sm" />
					<span>
						Sign-in must finish in a real browser tab. Use the preview's
						open-in-new-tab control, or use the link below.
					</span>
				</div>
			) : null}

			{tabOpenFailed ? (
				<div className="errorBanner" style={{ maxWidth: 460, marginTop: 14 }}>
					<WarningIcon className="icon sm" />
					<span>
						Your browser blocked the new tab. Use the preview's open-in-new-tab
						control, or use the direct link below.
					</span>
				</div>
			) : null}

			{embedded && tabUrl ? (
				<a
					className="buttonGhost"
					href={tabUrl}
					rel="noreferrer noopener"
					style={{ marginTop: 12 }}
					target="_blank"
				>
					Open this app in a new tab
				</a>
			) : null}

			<span className="signInNote">
				<LockIcon className="icon xs" />
				Credentials are encrypted and stored only in this browser.
			</span>

			{stuck ? (
				<div className="errorBanner" style={{ maxWidth: 460 }}>
					<WarningIcon className="icon sm" />
					<span>
						This is taking longer than expected. If a popup was blocked, allow
						popups for this site and{" "}
						<button onClick={onCancel} type="button">
							reset sign-in
						</button>
						. Then try again in a real browser tab. Hosted apps also need the
						Sign in with ChatGPT extension.
					</span>
				</div>
			) : null}

			{error ? (
				<div className="errorBanner" style={{ maxWidth: 460 }}>
					<WarningIcon className="icon sm" />
					<span>
						{error}{" "}
						<button onClick={handleSignIn} type="button">
							Try again
						</button>
					</span>
				</div>
			) : null}
		</main>
	)
}
