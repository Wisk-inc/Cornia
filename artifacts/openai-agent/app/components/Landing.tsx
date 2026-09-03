"use client"

import { useSignIn, useSignUp } from "@clerk/nextjs"
import { type FormEvent, useCallback, useMemo, useState } from "react"
import {
	AppleIcon,
	ArrowRightIcon,
	BookIcon,
	BrandIcon,
	CheckIcon,
	FolderIcon,
	GoogleIcon,
	ImageIcon,
	LockIcon,
	MailIcon,
	SparkleIcon,
	SpinnerIcon,
	TerminalIcon,
	WarningIcon,
} from "./icons"

const FEATURES = [
	{
		icon: TerminalIcon,
		title: "A real terminal",
		body: "Every chat gets its own sandbox. The agent installs packages, runs your code and shows you the output — and you can type into the same shell yourself.",
	},
	{
		icon: BookIcon,
		title: "Research that reads",
		body: "Ask it to research something and it runs several searches, opens the pages, and shows you every site it read — logos, extracts and links you can check.",
	},
	{
		icon: FolderIcon,
		title: "Files that exist",
		body: "It writes, edits and runs real files, clones repositories, and hands the whole workspace back to you as a zip.",
	},
	{
		icon: SparkleIcon,
		title: "Every model on your account",
		body: "The model list comes live from your own ChatGPT account, so a model OpenAI ships today shows up today.",
	},
	{
		icon: ImageIcon,
		title: "Images in the workspace",
		body: "Generated images are saved as files next to your code, not stranded in the chat log.",
	},
	{
		icon: LockIcon,
		title: "Your keys stay yours",
		body: "Your ChatGPT credentials are encrypted in your own browser. The server forwards them; it never stores them.",
	},
]

type Step = "email" | "code"
type Mode = "sign-up" | "sign-in"

type ClerkFailure = { code: string; message: string; longMessage?: string }

const readError = (error: unknown, fallback: string): string => {
	if (error && typeof error === "object") {
		const candidate = error as Partial<ClerkFailure>
		return candidate.longMessage ?? candidate.message ?? fallback
	}
	return fallback
}

const codeOf = (error: unknown): string | undefined =>
	error && typeof error === "object"
		? (error as Partial<ClerkFailure>).code
		: undefined

/**
 * The front door.
 *
 * Clerk's flow is driven by hand here rather than dropping in `<SignIn/>`, so
 * the provider buttons and the code box sit inside the page's own design
 * instead of an embedded card. These are the signal-based hooks, which report
 * failures as a returned `error` rather than by throwing.
 */
export function Landing() {
	const { signUp, fetchStatus: signUpFetch } = useSignUp()
	const { signIn, fetchStatus: signInFetch } = useSignIn()

	const [mode, setMode] = useState<Mode>("sign-up")
	const [step, setStep] = useState<Step>("email")
	const [email, setEmail] = useState("")
	const [code, setCode] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | undefined>(undefined)
	const [notice, setNotice] = useState<string | undefined>(undefined)
	// Which resource sent the code, so the code goes back to the same one.
	const [pending, setPending] = useState<Mode>("sign-up")

	const busy =
		submitting || signUpFetch === "fetching" || signInFetch === "fetching"

	const oauthRedirects = useMemo(() => {
		const origin = typeof window === "undefined" ? "" : window.location.origin
		return {
			redirectUrl: `${origin}/sso-callback`,
			redirectCallbackUrl: `${origin}/sso-callback`,
		}
	}, [])

	const startOAuth = useCallback(
		async (strategy: "oauth_google" | "oauth_apple") => {
			setError(undefined)
			setSubmitting(true)
			const { error: failure } = await signIn.sso({
				strategy,
				...oauthRedirects,
			})
			if (failure) {
				setSubmitting(false)
				setError(
					readError(
						failure,
						"That provider is not enabled for this application yet. Turn it on under Clerk → SSO connections.",
					),
				)
			}
			// On success the browser is already on its way to the provider.
		},
		[signIn, oauthRedirects],
	)

	/** Sends a six-digit code to an address that already has an account. */
	const sendSignInCode = useCallback(
		async (address: string) => {
			const { error: failure } = await signIn.emailCode.sendCode({
				emailAddress: address,
			})
			if (failure) {
				return failure
			}
			setPending("sign-in")
			setStep("code")
			return null
		},
		[signIn],
	)

	/** Creates the account and sends the code that verifies the address. */
	const sendSignUpCode = useCallback(
		async (address: string) => {
			const created = await signUp.create({ emailAddress: address })
			if (created.error) {
				return created.error
			}
			const sent = await signUp.verifications.sendEmailCode()
			if (sent.error) {
				return sent.error
			}
			setPending("sign-up")
			setStep("code")
			return null
		},
		[signUp],
	)

	const submitEmail = useCallback(
		async (event: FormEvent) => {
			event.preventDefault()
			const address = email.trim()
			if (busy || address.length === 0) {
				return
			}

			setSubmitting(true)
			setError(undefined)
			setNotice(undefined)
			try {
				if (mode === "sign-up") {
					const failure = await sendSignUpCode(address)
					if (!failure) {
						return
					}
					// Already registered — send them down the sign-in path rather than
					// making them find the other button.
					if (codeOf(failure) === "form_identifier_exists") {
						setNotice(
							"You already have an account — we sent you a sign-in code.",
						)
						const second = await sendSignInCode(address)
						if (second) {
							setError(readError(second, "Could not send the code."))
						}
						return
					}
					setError(readError(failure, "Could not create the account."))
					return
				}

				const failure = await sendSignInCode(address)
				if (!failure) {
					return
				}
				if (codeOf(failure) === "form_identifier_not_found") {
					setNotice("No account yet — we're creating one for you.")
					const second = await sendSignUpCode(address)
					if (second) {
						setError(readError(second, "Could not create the account."))
					}
					return
				}
				setError(readError(failure, "Could not send the code."))
			} finally {
				setSubmitting(false)
			}
		},
		[busy, email, mode, sendSignInCode, sendSignUpCode],
	)

	const submitCode = useCallback(
		async (event: FormEvent) => {
			event.preventDefault()
			const value = code.trim()
			if (busy || value.length === 0) {
				return
			}

			setSubmitting(true)
			setError(undefined)
			try {
				if (pending === "sign-up") {
					const verified = await signUp.verifications.verifyEmailCode({
						code: value,
					})
					if (verified.error) {
						setError(readError(verified.error, "That code did not work."))
						return
					}
					if (signUp.status !== "complete") {
						// The instance wants more than an email — a password, a name.
						// Clerk's hosted pages know how to collect those; this form does
						// not, and guessing would be worse than saying so.
						setError(
							"Your email is verified, but this Clerk application asks for more details before the account is created. Either finish on Clerk's hosted sign-up page, or make the email code the only sign-up requirement in the Clerk dashboard.",
						)
						return
					}
					const finished = await signUp.finalize()
					if (finished.error) {
						setError(readError(finished.error, "Could not start your session."))
					}
					return
				}

				const verified = await signIn.emailCode.verifyCode({ code: value })
				if (verified.error) {
					setError(readError(verified.error, "That code did not work."))
					return
				}
				if (signIn.status !== "complete") {
					setError(
						"That code was accepted, but this account needs another step. Finish signing in on Clerk's hosted page.",
					)
					return
				}
				const finished = await signIn.finalize()
				if (finished.error) {
					setError(readError(finished.error, "Could not start your session."))
				}
			} finally {
				setSubmitting(false)
			}
		},
		[busy, code, pending, signIn, signUp],
	)

	const resend = useCallback(async () => {
		setSubmitting(true)
		setError(undefined)
		const { error: failure } =
			pending === "sign-up"
				? await signUp.verifications.sendEmailCode()
				: await signIn.emailCode.sendCode()
		if (failure) {
			setError(readError(failure, "Could not send another code."))
		} else {
			setNotice("A new code is on its way.")
		}
		setSubmitting(false)
	}, [pending, signIn, signUp])

	return (
		<main className="landing">
			<div className="landingGlow" />

			<header className="landingNav">
				<span className="landingBrand">
					<BrandIcon className="icon" />
					Cornia
				</span>
				<button
					className="landingNavLink"
					onClick={() => {
						setMode(mode === "sign-up" ? "sign-in" : "sign-up")
						setStep("email")
						setError(undefined)
						setNotice(undefined)
					}}
					type="button"
				>
					{mode === "sign-up" ? "Sign in" : "Create an account"}
				</button>
			</header>

			<section className="landingHero">
				<div className="landingCopy">
					<span className="landingEyebrow">
						<SparkleIcon className="icon xs" />
						Your ChatGPT account, with hands
					</span>
					<h1>
						An agent that actually
						<br />
						<span className="landingGradient">runs the code</span>
					</h1>
					<p className="landingLede">
						Plans the work, writes the files, installs what it needs, runs it in
						a real sandbox terminal, and researches the web by reading the pages
						— not just linking them. Powered by your own ChatGPT account.
					</p>

					<ul className="landingPoints">
						<li>
							<CheckIcon className="icon xs" /> No API key — sign in with ChatGPT
						</li>
						<li>
							<CheckIcon className="icon xs" /> Every model your account can see
						</li>
						<li>
							<CheckIcon className="icon xs" /> Your workspace, downloadable as a zip
						</li>
					</ul>
				</div>

				<div className="authCard">
					{step === "email" ? (
						<>
							<h2>
								{mode === "sign-up" ? "Create your account" : "Welcome back"}
							</h2>
							<p className="authSub">
								{mode === "sign-up"
									? "Takes about twenty seconds. We'll email you a code."
									: "We'll email you a six-digit code — no password to remember."}
							</p>

							<div className="authProviders">
								<button
									className="authProvider"
									disabled={busy}
									onClick={() => void startOAuth("oauth_google")}
									type="button"
								>
									<GoogleIcon className="icon sm" />
									Continue with Google
								</button>
								<button
									className="authProvider"
									disabled={busy}
									onClick={() => void startOAuth("oauth_apple")}
									type="button"
								>
									<AppleIcon className="icon sm" />
									Continue with Apple
								</button>
							</div>

							<div className="authDivider">
								<span>or with email</span>
							</div>

							<form className="authForm" onSubmit={(event) => void submitEmail(event)}>
								<label className="authField">
									<MailIcon className="icon sm" />
									<input
										autoComplete="email"
										disabled={busy}
										inputMode="email"
										onChange={(event) => setEmail(event.target.value)}
										placeholder="you@example.com"
										required
										type="email"
										value={email}
									/>
								</label>
								<button
									className="authSubmit"
									disabled={busy || email.trim().length === 0}
									type="submit"
								>
									{busy ? (
										<SpinnerIcon className="icon sm spin" />
									) : (
										<ArrowRightIcon className="icon sm" />
									)}
									{mode === "sign-up" ? "Send my code" : "Email me a code"}
								</button>
							</form>

							<p className="authSwitch">
								{mode === "sign-up" ? "Already have an account?" : "New here?"}{" "}
								<button
									onClick={() => {
										setMode(mode === "sign-up" ? "sign-in" : "sign-up")
										setError(undefined)
										setNotice(undefined)
									}}
									type="button"
								>
									{mode === "sign-up" ? "Sign in" : "Create one"}
								</button>
							</p>
						</>
					) : (
						<>
							<h2>Check your email</h2>
							<p className="authSub">
								We sent a six-digit code to <strong>{email}</strong>.
							</p>

							<form className="authForm" onSubmit={(event) => void submitCode(event)}>
								<input
									aria-label="Verification code"
									autoComplete="one-time-code"
									className="authCode"
									disabled={busy}
									inputMode="numeric"
									maxLength={6}
									onChange={(event) =>
										setCode(event.target.value.replace(/\D/g, ""))
									}
									placeholder="000000"
									required
									value={code}
								/>
								<button
									className="authSubmit"
									disabled={busy || code.length < 6}
									type="submit"
								>
									{busy ? (
										<SpinnerIcon className="icon sm spin" />
									) : (
										<CheckIcon className="icon sm" />
									)}
									Verify and continue
								</button>
							</form>

							<p className="authSwitch">
								Didn't get it?{" "}
								<button disabled={busy} onClick={() => void resend()} type="button">
									Send another
								</button>{" "}
								·{" "}
								<button
									onClick={() => {
										setStep("email")
										setCode("")
										setError(undefined)
									}}
									type="button"
								>
									Use a different email
								</button>
							</p>
						</>
					)}

					{notice ? <p className="authNotice">{notice}</p> : null}

					{error ? (
						<div className="errorBanner" style={{ marginTop: 12 }}>
							<WarningIcon className="icon sm" />
							<span>{error}</span>
						</div>
					) : null}

					<span className="authFinePrint">
						<LockIcon className="icon xs" />
						Accounts are handled by Clerk. Your ChatGPT credentials never leave
						your browser.
					</span>
				</div>
			</section>

			<section className="landingFeatures">
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
		</main>
	)
}
