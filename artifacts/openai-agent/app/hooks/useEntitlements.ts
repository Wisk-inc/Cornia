"use client"

import { useCallback, useEffect, useState } from "react"
import type { EntitlementsView } from "../lib/entitlements"
import { FREE_MODEL, type PlanFeature, type PlanId } from "../lib/plans"
import type { UsageStatus } from "../lib/usage"

type EntitlementsResponse = EntitlementsView & {
	freeModel: string
	usage: UsageStatus
}

export type EntitlementsState = {
	planId: PlanId
	planName: string
	features: Set<PlanFeature>
	freeModel: string
	turnLimit: number
	windowHours: number
	maxUploadBytes: number
	usage?: UsageStatus
	loading: boolean
	error?: string
	/** True once a real answer has come back, rather than the assumed default. */
	loaded: boolean
	can: (feature: PlanFeature) => boolean
	allowsModel: (modelId: string) => boolean
	refresh: () => Promise<void>
}

/**
 * Assume the smaller plan until told otherwise.
 *
 * A blank first paint that then locks things is worse than one that starts
 * locked and opens up, and it means a failed request can never accidentally
 * present paid features as available.
 */
const INITIAL = {
	planId: "free" as PlanId,
	planName: "Cornia Free",
	features: new Set<PlanFeature>(),
	freeModel: FREE_MODEL,
	turnLimit: 20,
	windowHours: 24,
	maxUploadBytes: 5 * 1024 * 1024,
	usage: undefined as UsageStatus | undefined,
	loading: true,
	error: undefined as string | undefined,
	loaded: false,
}

export const useEntitlements = (enabled: boolean): EntitlementsState => {
	const [state, setState] = useState(INITIAL)

	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/agent-api/entitlements", {
				cache: "no-store",
			})
			if (!response.ok) {
				throw new Error(`Could not read your plan (HTTP ${response.status}).`)
			}
			const payload = (await response.json()) as EntitlementsResponse
			setState({
				planId: payload.planId,
				planName: payload.planName,
				features: new Set(payload.features),
				freeModel: payload.freeModel,
				turnLimit: payload.turnLimit,
				windowHours: payload.windowHours,
				maxUploadBytes: payload.maxUploadBytes,
				usage: payload.usage,
				loading: false,
				error: undefined,
				loaded: true,
			})
		} catch (error) {
			setState((current) => ({
				...current,
				loading: false,
				error: error instanceof Error ? error.message : String(error),
			}))
		}
	}, [])

	useEffect(() => {
		if (enabled) {
			void refresh()
		}
	}, [enabled, refresh])

	const can = useCallback(
		(feature: PlanFeature) => state.features.has(feature),
		[state.features],
	)

	const allowsModel = useCallback(
		(modelId: string) =>
			state.features.has("allModels") || modelId === state.freeModel,
		[state.features, state.freeModel],
	)

	return { ...state, can, allowsModel, refresh }
}
