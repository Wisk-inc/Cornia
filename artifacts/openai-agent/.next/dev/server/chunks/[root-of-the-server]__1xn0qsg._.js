module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/artifacts/openai-agent/app/lib/models.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_MODEL_PREFERENCE",
    ()=>DEFAULT_MODEL_PREFERENCE,
    "fallbackCatalog",
    ()=>fallbackCatalog,
    "fetchModelCatalog",
    ()=>fetchModelCatalog,
    "loadCatalogCached",
    ()=>loadCatalogCached,
    "pickDefaultModel",
    ()=>pickDefaultModel,
    "prettyModelLabel",
    ()=>prettyModelLabel,
    "providerOptionsFor",
    ()=>providerOptionsFor,
    "resolveCodexClientVersion",
    ()=>resolveCodexClientVersion
]);
const CODEX_REGISTRY_URL = "https://registry.npmjs.org/@openai/codex/latest";
const FALLBACK_CODEX_VERSION = "0.144.1";
const VERSION_CACHE_TTL_MS = 60 * 60 * 1000;
let cachedVersion;
let cachedVersionExpiresAt = 0;
const resolveCodexClientVersion = async ()=>{
    if (process.env.CODEX_CLIENT_VERSION) {
        return process.env.CODEX_CLIENT_VERSION;
    }
    if (cachedVersion && Date.now() < cachedVersionExpiresAt) {
        return cachedVersion;
    }
    try {
        const response = await fetch(CODEX_REGISTRY_URL, {
            headers: {
                accept: "application/json"
            },
            signal: AbortSignal.timeout(8_000)
        });
        if (response.ok) {
            const payload = await response.json();
            const version = typeof payload.version === "string" ? payload.version.match(/\b\d+\.\d+\.\d+\b/)?.[0] : undefined;
            if (version) {
                cachedVersion = version;
                cachedVersionExpiresAt = Date.now() + VERSION_CACHE_TTL_MS;
                return version;
            }
        }
    } catch  {
    // Fall through to the pinned version.
    }
    cachedVersion = FALLBACK_CODEX_VERSION;
    cachedVersionExpiresAt = Date.now() + VERSION_CACHE_TTL_MS;
    return FALLBACK_CODEX_VERSION;
};
const isRecord = (value)=>typeof value === "object" && value !== null && !Array.isArray(value);
const titleCase = (value)=>value.charAt(0).toUpperCase() + value.slice(1);
const ACRONYMS = new Set([
    "api",
    "hd",
    "sfx",
    "tts",
    "ui",
    "vl"
]);
const prettyModelLabel = (slug)=>{
    const parts = slug.split(/[-_]/).filter((part)=>part.length > 0);
    const words = [];
    for(let index = 0; index < parts.length; index += 1){
        const part = parts[index];
        if (/^gpt$/i.test(part)) {
            const version = parts[index + 1];
            if (version && /^\d[\d.]*$/.test(version)) {
                words.push(`GPT-${version}`);
                index += 1;
                continue;
            }
            words.push("GPT");
            continue;
        }
        if (/^o\d/i.test(part) || /^\d/.test(part)) {
            words.push(part);
            continue;
        }
        if (ACRONYMS.has(part.toLowerCase())) {
            words.push(part.toUpperCase());
            continue;
        }
        words.push(titleCase(part));
    }
    return words.join(" ");
};
const describeModel = (model)=>{
    const traits = [];
    if (/codex/i.test(model.id)) {
        traits.push("Tuned for coding and agentic work");
    } else if (/mini|nano|flash/i.test(model.id)) {
        traits.push("Fast and lightweight");
    } else if (/pro|max|high/i.test(model.id)) {
        traits.push("Deepest reasoning, slowest");
    } else {
        traits.push("Balanced everyday model");
    }
    if (model.experimental) {
        traits.push(model.visibility === "hide" ? "hidden from the public list" : "not publicly listed");
    }
    if (!model.supportedInApi) {
        traits.push("may not accept API requests");
    }
    return traits.join(" · ");
};
const toAgentModel = (raw)=>{
    const id = typeof raw.slug === "string" ? raw.slug : typeof raw.id === "string" ? raw.id : typeof raw.model === "string" ? raw.model : undefined;
    if (!id || /image|audio|tts|whisper|embed|moderation/i.test(id)) {
        return null;
    }
    const visibility = typeof raw.visibility === "string" ? raw.visibility : undefined;
    const supportedInApi = raw.supported_in_api !== false;
    // The catalog marks models "list" (public) or "hide". Hidden usually means
    // superseded rather than upcoming, so group them without promising either.
    const experimental = visibility !== undefined && visibility !== "list" || !supportedInApi || /experimental|preview|alpha|beta|internal|canary/i.test(id);
    // The catalog lists levels either as plain strings or as {effort, description}.
    const reasoningLevels = Array.isArray(raw.supported_reasoning_levels) ? raw.supported_reasoning_levels.map((level)=>typeof level === "string" ? level : isRecord(level) && typeof level.effort === "string" ? level.effort : undefined).filter((level)=>level !== undefined) : [];
    const model = {
        id,
        label: typeof raw.display_name === "string" && raw.display_name.trim() || typeof raw.name === "string" && raw.name.trim() || prettyModelLabel(id),
        description: "",
        group: experimental ? "experimental" : "standard",
        experimental,
        supportedInApi,
        reasoning: typeof raw.default_reasoning_level === "string",
        defaultReasoningEffort: typeof raw.default_reasoning_level === "string" ? raw.default_reasoning_level : undefined,
        reasoningLevels,
        defaultReasoningSummary: typeof raw.default_reasoning_summary === "string" ? raw.default_reasoning_summary : undefined,
        supportsVerbosity: raw.support_verbosity === true,
        plans: Array.isArray(raw.available_in_plans) ? raw.available_in_plans.filter((plan)=>typeof plan === "string") : [],
        visibility
    };
    model.description = describeModel(model);
    return model;
};
const sortModels = (models)=>[
        ...models
    ].sort((left, right)=>{
        if (left.group !== right.group) {
            return left.group === "standard" ? -1 : 1;
        }
        const codexDelta = Number(/codex/i.test(right.id)) - Number(/codex/i.test(left.id));
        if (codexDelta !== 0) {
            return codexDelta;
        }
        return right.id.localeCompare(left.id, "en", {
            numeric: true
        });
    });
const fetchModelCatalog = async (transport)=>{
    const clientVersion = await resolveCodexClientVersion();
    try {
        const response = await transport.request(`/models?client_version=${encodeURIComponent(clientVersion)}`);
        const body = await response.text();
        if (response.ok) {
            const parsed = JSON.parse(body);
            if (isRecord(parsed) && Array.isArray(parsed.models)) {
                const models = parsed.models.filter(isRecord).map(toAgentModel).filter((model)=>model !== null);
                if (models.length > 0) {
                    return {
                        models: sortModels(models),
                        clientVersion,
                        source: "codex-catalog",
                        fetchedAt: Date.now()
                    };
                }
            }
        }
    } catch  {
    // Fall back to the OpenAI-compatible listing below.
    }
    const response = await transport.request("/models");
    const body = await response.text();
    if (!response.ok) {
        // A reachable-but-unhappy endpoint should not leave the app unusable.
        if (response.status >= 500 || response.status === 404) {
            return fallbackCatalog(clientVersion);
        }
        throw new Error((()=>{
            try {
                const parsed = JSON.parse(body);
                if (isRecord(parsed) && isRecord(parsed.error)) {
                    return String(parsed.error.message ?? "Failed to load models.");
                }
            } catch  {}
            return body || "Failed to load models.";
        })());
    }
    const parsed = JSON.parse(body);
    const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
    const models = data.filter(isRecord).map((entry)=>typeof entry.id === "string" ? toAgentModel({
            slug: entry.id
        }) : null).filter((model)=>model !== null);
    if (models.length === 0) {
        return fallbackCatalog(clientVersion);
    }
    return {
        models: sortModels(models),
        clientVersion,
        source: "openai-compatible",
        fetchedAt: Date.now()
    };
};
const DEFAULT_MODEL_PREFERENCE = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4-codex",
    "gpt-5.4",
    "gpt-5.4-mini"
];
/**
 * Used only when the catalog cannot be reached, so the app still works instead
 * of showing an empty picker. These slugs and their capabilities come from the
 * model list shipped inside the Codex client itself.
 */ const FALLBACK_MODELS = [
    {
        slug: "gpt-5.6-sol",
        visibility: "list",
        default_reasoning_level: "low",
        default_reasoning_summary: "none",
        support_verbosity: true,
        supported_reasoning_levels: [
            {
                effort: "low"
            },
            {
                effort: "medium"
            },
            {
                effort: "high"
            },
            {
                effort: "xhigh"
            },
            {
                effort: "max"
            },
            {
                effort: "ultra"
            }
        ]
    },
    {
        slug: "gpt-5.6-terra",
        visibility: "list",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true,
        supported_reasoning_levels: [
            {
                effort: "low"
            },
            {
                effort: "medium"
            },
            {
                effort: "high"
            },
            {
                effort: "xhigh"
            }
        ]
    },
    {
        slug: "gpt-5.6-luna",
        visibility: "list",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true,
        supported_reasoning_levels: [
            {
                effort: "low"
            },
            {
                effort: "medium"
            },
            {
                effort: "high"
            }
        ]
    },
    {
        slug: "gpt-5.5",
        visibility: "list",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true,
        supported_reasoning_levels: [
            {
                effort: "low"
            },
            {
                effort: "medium"
            },
            {
                effort: "high"
            }
        ]
    },
    {
        slug: "gpt-5.4",
        visibility: "hide",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5.4-mini",
        visibility: "hide",
        default_reasoning_level: "low",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5",
        visibility: "hide",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5-mini",
        visibility: "hide",
        default_reasoning_level: "low",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5-nano",
        visibility: "hide",
        default_reasoning_level: "low",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5-codex",
        visibility: "hide",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5.3-codex",
        visibility: "hide",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5-cybersecurity",
        display_name: "GPT Cybersecurity",
        visibility: "hide",
        default_reasoning_level: "high",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "gpt-5.4-cybersecurity",
        display_name: "GPT-5.4 Cybersecurity",
        visibility: "hide",
        default_reasoning_level: "high",
        default_reasoning_summary: "none",
        support_verbosity: true
    },
    {
        slug: "daybreak-red",
        display_name: "Daybreak Red",
        visibility: "hide",
        default_reasoning_level: "medium",
        default_reasoning_summary: "none",
        support_verbosity: true
    }
];
const fallbackCatalog = (clientVersion)=>({
        models: sortModels(FALLBACK_MODELS.map(toAgentModel).filter((model)=>model !== null)),
        clientVersion,
        source: "fallback",
        fetchedAt: Date.now()
    });
const pickDefaultModel = (models)=>{
    for (const preferred of DEFAULT_MODEL_PREFERENCE){
        if (models.some((model)=>model.id === preferred)) {
            return preferred;
        }
    }
    return models.find((model)=>!model.experimental)?.id ?? models[0]?.id;
};
const CATALOG_TTL_MS = 5 * 60 * 1000;
let cachedCatalog;
const loadCatalogCached = async (transport)=>{
    if (cachedCatalog && Date.now() < cachedCatalog.expiresAt) {
        return cachedCatalog.catalog;
    }
    try {
        const catalog = await fetchModelCatalog(transport);
        cachedCatalog = {
            catalog,
            expiresAt: Date.now() + CATALOG_TTL_MS
        };
        return catalog;
    } catch  {
        return cachedCatalog?.catalog;
    }
};
const providerOptionsFor = (model, requestedEffort, requestedVerbosity)=>{
    const options = {};
    if (requestedEffort && model && model.reasoningLevels.includes(requestedEffort)) {
        options.reasoningEffort = requestedEffort;
    } else if (requestedEffort && model && model.reasoningLevels.length === 0) {
        // No advertised list: trust the catalog default instead of guessing.
        if (model.defaultReasoningEffort === requestedEffort) {
            options.reasoningEffort = requestedEffort;
        }
    }
    if (model?.defaultReasoningSummary && model.defaultReasoningSummary !== "none") {
        options.reasoningSummary = model.defaultReasoningSummary;
    }
    if (requestedVerbosity && model?.supportsVerbosity) {
        options.textVerbosity = requestedVerbosity;
    }
    return Object.keys(options).length > 0 ? {
        openai: options
    } : undefined;
};
}),
"[project]/artifacts/openai-agent/app/lib/openai.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "errorMessage",
    ()=>errorMessage,
    "isAuthError",
    ()=>isAuthError,
    "providerCredentials",
    ()=>providerCredentials,
    "sessionFromRequest",
    ()=>sessionFromRequest,
    "transportFromRequest",
    ()=>transportFromRequest
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$openai$2d$oauth$2b$core$40$2$2e$0$2e$0$2f$node_modules$2f40$openai$2d$oauth$2f$core$2f$dist$2f$runtime$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/@openai-oauth+core@2.0.0/node_modules/@openai-oauth/core/dist/runtime.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$openai$2d$oauth$2b$web$40$2$2e$0$2e$0$2f$node_modules$2f40$openai$2d$oauth$2f$web$2f$dist$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/@openai-oauth+web@2.0.0/node_modules/@openai-oauth/web/dist/server.js [app-route] (ecmascript)");
;
;
/**
 * Points the provider at a different Codex-compatible upstream. Empty in
 * normal use; set it to run against a local proxy or a stub during tests.
 */ const codexBaseURL = process.env.CODEX_BASE_URL || undefined;
const sessionFromRequest = (request)=>{
    const credentials = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$openai$2d$oauth$2b$web$40$2$2e$0$2e$0$2f$node_modules$2f40$openai$2d$oauth$2f$web$2f$dist$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["openaiCredentials"])(request, {
        baseURL: codexBaseURL
    });
    return async ()=>{
        const session = await credentials.getSession();
        if (!session) {
            throw new Error("Not signed in with ChatGPT.");
        }
        return session;
    };
};
const transportFromRequest = (request)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$openai$2d$oauth$2b$core$40$2$2e$0$2e$0$2f$node_modules$2f40$openai$2d$oauth$2f$core$2f$dist$2f$runtime$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createOpenAIOAuthTransport"])({
        auth: sessionFromRequest(request),
        baseURL: codexBaseURL
    });
const providerCredentials = (request)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f40$openai$2d$oauth$2b$web$40$2$2e$0$2e$0$2f$node_modules$2f40$openai$2d$oauth$2f$web$2f$dist$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["openaiCredentials"])(request, {
        baseURL: codexBaseURL
    });
const isAuthError = (error)=>{
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Not signed in") || message.includes("must include `Authorization`") || message.includes("session not found");
};
const isRecord = (value)=>typeof value === "object" && value !== null;
/** Digs the upstream explanation out of an API error body when there is one. */ const upstreamDetail = (body)=>{
    try {
        const parsed = JSON.parse(body);
        if (isRecord(parsed)) {
            if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
                return parsed.error.message;
            }
            if (typeof parsed.detail === "string") {
                return parsed.detail;
            }
            if (typeof parsed.message === "string") {
                return parsed.message;
            }
        }
    } catch  {}
    return body.trim().length > 0 ? body.slice(0, 400) : undefined;
};
const errorMessage = (error)=>{
    if (!(error instanceof Error)) {
        return String(error);
    }
    const candidate = error;
    const detail = typeof candidate.responseBody === "string" ? upstreamDetail(candidate.responseBody) : undefined;
    if (detail && !error.message.includes(detail)) {
        const status = typeof candidate.statusCode === "number" ? ` (${candidate.statusCode})` : "";
        return `${error.message}${status}: ${detail}`;
    }
    return error.message;
};
}),
"[project]/artifacts/openai-agent/app/api/models/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "dynamic",
    ()=>dynamic
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$models$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/artifacts/openai-agent/app/lib/models.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$openai$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/artifacts/openai-agent/app/lib/openai.ts [app-route] (ecmascript)");
;
;
const dynamic = "force-dynamic";
async function GET(request) {
    try {
        const catalog = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$models$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fetchModelCatalog"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$openai$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["transportFromRequest"])(request));
        return Response.json({
            ...catalog,
            defaultModel: (0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$models$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pickDefaultModel"])(catalog.models)
        }, {
            headers: {
                "cache-control": "no-store"
            }
        });
    } catch (error) {
        // Signed out is worth reporting; anything else should still leave the app
        // usable, so fall back to the models the Codex client itself ships with.
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$openai$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["isAuthError"])(error)) {
            return Response.json({
                error: (0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$openai$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["errorMessage"])(error)
            }, {
                status: 401
            });
        }
        const catalog = (0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$models$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fallbackCatalog"])(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$models$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveCodexClientVersion"])());
        return Response.json({
            ...catalog,
            defaultModel: (0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$models$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pickDefaultModel"])(catalog.models),
            warning: `Could not read the model list from your account (${(0, __TURBOPACK__imported__module__$5b$project$5d2f$artifacts$2f$openai$2d$agent$2f$app$2f$lib$2f$openai$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["errorMessage"])(error)}). Showing the known model list instead.`
        }, {
            headers: {
                "cache-control": "no-store"
            }
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1xn0qsg._.js.map