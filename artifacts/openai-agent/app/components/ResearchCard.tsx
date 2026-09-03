"use client"

import { useState } from "react"
import {
	BookIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	GlobeIcon,
	SpinnerIcon,
	WarningIcon,
} from "./icons"

export type ResearchSourceView = {
	url: string
	title: string
	site: string
	favicon: string
	snippet?: string
	extract?: string
	words?: number
	read?: boolean
	error?: string
}

/**
 * A site's icon, from this app's own favicon proxy. A site with no icon falls
 * back to a globe so the row still lines up with the ones that do have one.
 */
function SiteIcon({
	source,
	size = 18,
}: {
	source: ResearchSourceView
	size?: number
}) {
	const [failed, setFailed] = useState(false)

	if (failed || !source.favicon) {
		return <GlobeIcon className="icon xs researchGlobe" />
	}
	return (
		// biome-ignore lint/performance/noImgElement: proxied favicon, no loader needed
		<img
			alt=""
			className="researchFavicon"
			height={size}
			loading="lazy"
			onError={() => setFailed(true)}
			src={source.favicon}
			width={size}
		/>
	)
}

function SourceRow({ source }: { source: ResearchSourceView }) {
	const [open, setOpen] = useState(false)
	const body = source.extract || source.snippet

	return (
		<li className={`researchSource ${source.read === false ? "partial" : ""}`}>
			<div className="researchSourceHead">
				<SiteIcon source={source} />
				<a
					className="researchSourceTitle"
					href={source.url}
					rel="noreferrer noopener"
					target="_blank"
				>
					{source.title}
				</a>
				<span className="researchSite">{source.site}</span>
				{source.read === false ? (
					<span className="researchBadge" title={source.error}>
						<WarningIcon className="icon xs" />
						snippet only
					</span>
				) : source.words ? (
					<span className="researchBadge">
						<CheckIcon className="icon xs" />
						{source.words.toLocaleString()} words
					</span>
				) : null}
				{body ? (
					<button
						aria-expanded={open}
						aria-label={open ? "Hide extract" : "Show extract"}
						className="researchToggle"
						onClick={() => setOpen((value) => !value)}
						type="button"
					>
						{open ? (
							<ChevronDownIcon className="icon xs" />
						) : (
							<ChevronRightIcon className="icon xs" />
						)}
					</button>
				) : null}
			</div>

			{body ? (
				<p className={`researchExtract ${open ? "open" : ""}`}>{body}</p>
			) : null}
		</li>
	)
}

/**
 * What the agent read, shown the way a person would want to check it: the sites
 * first, with their own logos, then what each one actually said.
 */
export function ResearchCard({
	topic,
	queries,
	sources,
	running,
	provider,
}: {
	topic?: string
	queries?: string[]
	sources: ResearchSourceView[]
	running: boolean
	provider?: string
}) {
	const read = sources.filter((source) => source.read !== false).length

	return (
		<div className="researchCard">
			<div className="researchHead">
				<span className="researchHeadIcon">
					{running ? (
						<SpinnerIcon className="icon sm spin" />
					) : (
						<BookIcon className="icon sm" />
					)}
				</span>
				<div className="researchHeadText">
					<span className={running ? "shimmer" : undefined}>
						{running ? "Researching" : "Researched"}
						{topic ? ` · ${topic}` : ""}
					</span>
					{sources.length > 0 ? (
						<span className="researchMeta">
							read {read} of {sources.length} sources
							{provider && provider !== "none" ? ` · via ${provider}` : ""}
						</span>
					) : null}
				</div>
			</div>

			{queries && queries.length > 0 ? (
				<div className="researchQueries">
					{queries.map((query) => (
						<span className="researchQuery" key={query}>
							{query}
						</span>
					))}
				</div>
			) : null}

			{sources.length > 0 ? (
				<>
					{/* The strip of logos is the quick answer to "where did this come
					    from?"; the list below is the detail. */}
					<div className="researchLogos">
						{sources.map((source) => (
							<a
								className="researchLogo"
								href={source.url}
								key={source.url}
								rel="noreferrer noopener"
								target="_blank"
								title={`${source.title} — ${source.site}`}
							>
								<SiteIcon size={22} source={source} />
							</a>
						))}
					</div>

					<ul className="researchSources">
						{sources.map((source) => (
							<SourceRow key={source.url} source={source} />
						))}
					</ul>
				</>
			) : running ? (
				<p className="researchPending">Searching and opening pages…</p>
			) : null}
		</div>
	)
}
