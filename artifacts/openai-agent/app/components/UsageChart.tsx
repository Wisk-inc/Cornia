"use client"

import { useMemo, useState } from "react"
import type { UsageHistoryPoint } from "../lib/usage"

/** Axis ticks land on round numbers, so 17 tops out at 20 rather than 17. */
const niceCeiling = (value: number): number => {
	if (value <= 5) {
		return 5
	}
	const magnitude = 10 ** Math.floor(Math.log10(value))
	for (const step of [1, 2, 2.5, 5, 10]) {
		const candidate = step * magnitude
		if (candidate >= value) {
			return candidate
		}
	}
	return 10 * magnitude
}

const shortDay = (iso: string): string =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	})

const longDay = (iso: string): string =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
		day: "numeric",
		month: "long",
		timeZone: "UTC",
		weekday: "long",
	})

/**
 * Messages per day.
 *
 * One series, so there is no legend — the heading says what is plotted. Only the
 * busiest day is labelled directly; the axis and the tooltip carry the rest, and
 * the table view underneath makes every value reachable without hovering.
 */
export function UsageChart({
	history,
	label = "Messages per day",
}: {
	history: UsageHistoryPoint[]
	label?: string
}) {
	const [asTable, setAsTable] = useState(false)
	const [hovered, setHovered] = useState<string | undefined>(undefined)

	const { top, busiest, total } = useMemo(() => {
		const peak = history.reduce((most, point) => Math.max(most, point.turns), 0)
		return {
			top: niceCeiling(peak),
			// Labelled directly. The last of equal peaks wins, so a fresh busy day
			// takes the label rather than an older tie.
			busiest: history.reduce<UsageHistoryPoint | undefined>(
				(best, point) =>
					point.turns > 0 && (!best || point.turns >= best.turns)
						? point
						: best,
				undefined,
			),
			total: history.reduce((sum, point) => sum + point.turns, 0),
		}
	}, [history])

	const ticks = [top, top / 2, 0]

	return (
		<section className="chartCard">
			<header className="chartHead">
				<div>
					<h3>{label}</h3>
					<p className="chartSub">
						{total.toLocaleString()} in the last {history.length} days
					</p>
				</div>
				<button
					className="chartToggle"
					onClick={() => setAsTable((current) => !current)}
					type="button"
				>
					{asTable ? "Chart" : "Table"}
				</button>
			</header>

			{asTable ? (
				<div className="chartTableWrap">
					<table className="chartTable">
						<caption className="visuallyHidden">{label}</caption>
						<thead>
							<tr>
								<th scope="col">Day</th>
								<th scope="col">Messages</th>
							</tr>
						</thead>
						<tbody>
							{[...history].reverse().map((point) => (
								<tr key={point.day}>
									<th scope="row">{longDay(point.day)}</th>
									<td>{point.turns}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<div className="chartBody">
					<div className="chartYAxis">
						{ticks.map((tick) => (
							<span key={tick}>{Math.round(tick).toLocaleString()}</span>
						))}
					</div>

					<div className="chartPlot">
						{/* Hairline, solid, one step off the surface — recessive. */}
						{ticks.map((tick) => (
							<span
								className="chartGrid"
								key={tick}
								style={{ bottom: `${(tick / top) * 100}%` }}
							/>
						))}

						{history.map((point) => {
							const height = top === 0 ? 0 : (point.turns / top) * 100
							const isPeak = busiest?.day === point.day
							return (
								<button
									className={`chartColumn ${hovered === point.day ? "hovered" : ""}`}
									key={point.day}
									onBlur={() => setHovered(undefined)}
									onFocus={() => setHovered(point.day)}
									onMouseEnter={() => setHovered(point.day)}
									onMouseLeave={() => setHovered(undefined)}
									type="button"
								>
									{hovered === point.day ? (
										<span className="chartTip" role="tooltip">
											<strong>{point.turns}</strong>{" "}
											{point.turns === 1 ? "message" : "messages"}
											<br />
											{longDay(point.day)}
										</span>
									) : null}

									{isPeak && point.turns > 0 ? (
										<span className="chartPeakLabel">{point.turns}</span>
									) : null}

									<span
										className={`chartBar ${point.turns === 0 ? "empty" : ""}`}
										style={{ height: point.turns === 0 ? "2px" : `${height}%` }}
									/>
									<span className="visuallyHidden">
										{longDay(point.day)}: {point.turns} messages
									</span>
								</button>
							)
						})}
					</div>

					<div className="chartXAxis">
						{history.map((point, index) => (
							// Every other tick, so the labels never collide.
							<span key={point.day}>
								{index % 2 === 0 || index === history.length - 1
									? shortDay(point.day)
									: ""}
							</span>
						))}
					</div>
				</div>
			)}
		</section>
	)
}
