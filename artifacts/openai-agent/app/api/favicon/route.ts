export const dynamic = "force-dynamic"

const FETCH_TIMEOUT_MS = 6_000
const CACHE_HEADER = "public, max-age=86400, stale-while-revalidate=604800"

// Only real hostnames; nothing that could point back inside the network.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9-]{1,63})+$/i
const BLOCKED = /^(localhost$|.*\.local$|.*\.internal$)/i

/** A neutral globe, so a site with no icon still lines up with the others. */
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>`

const placeholderResponse = () =>
	new Response(PLACEHOLDER, {
		headers: {
			"content-type": "image/svg+xml; charset=utf-8",
			"cache-control": CACHE_HEADER,
		},
	})

/**
 * Proxies a site's icon so research results can show who they came from without
 * the browser calling an icon service directly — that would leak the list of
 * pages the agent read to a third party on every render.
 */
export async function GET(request: Request) {
	const domain = new URL(request.url).searchParams
		.get("domain")
		?.trim()
		.toLowerCase()

	if (!domain || !DOMAIN_PATTERN.test(domain) || BLOCKED.test(domain)) {
		return placeholderResponse()
	}

	const sources = [
		`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
		`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
		`https://${domain}/favicon.ico`,
	]

	for (const source of sources) {
		try {
			const response = await fetch(source, {
				redirect: "follow",
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			})
			const contentType = response.headers.get("content-type") ?? ""
			if (!response.ok || !/image|icon/i.test(contentType)) {
				continue
			}
			const body = new Uint8Array(await response.arrayBuffer())
			// Some hosts answer a missing icon with a 1x1 pixel rather than a 404.
			if (body.byteLength < 64) {
				continue
			}
			return new Response(body, {
				headers: {
					"content-type": contentType.split(";")[0] ?? "image/png",
					"cache-control": CACHE_HEADER,
					"x-content-type-options": "nosniff",
				},
			})
		} catch {
			// Try the next source.
		}
	}

	return placeholderResponse()
}
