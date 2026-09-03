# Cornia

A ChatGPT-style coding agent: it plans a task, writes real files, installs what
it needs, runs the code in a per-conversation sandbox terminal, researches the
web by reading pages rather than just linking them, and hands the whole
workspace back as a zip. Models come live from the signed-in user's own ChatGPT
account, so no API key is needed.

## Run & Operate

- `pnpm --filter @workspace/openai-agent run dev` — run the agent app (port 18917)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

### Environment

`artifacts/openai-agent/.env.example` documents every variable. Copy it to
`.env.local` (gitignored) and fill in what you need. Nothing is mandatory:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — app accounts. With
  no publishable key the whole Clerk layer is skipped and the app goes straight
  to the ChatGPT sign-in, which is the single-user local setup.
- `OPENAI_API_KEY` — only used when the signed-in ChatGPT account is not allowed
  to generate images.
- `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` / `SEARXNG_URL` — search backend.
  Without one, search falls back to DuckDuckGo, which needs no key but
  rate-limits hard.
- `AGENT_SANDBOX_COMMAND` — wraps every terminal command, e.g. to run it in a
  container. See "Gotchas".
- `DATABASE_URL` — Postgres, for the separate API server package.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Agent app: Next.js 16 (App Router), React 19, Vercel AI SDK v6
- Auth: Clerk for app accounts; `@openai-oauth/*` for ChatGPT model access
- API: Express 5 · DB: PostgreSQL + Drizzle · Validation: Zod (`zod/v4`)

## Where things live

Everything user-facing is in `artifacts/openai-agent`:

- `app/page.tsx` — the gate: landing page when signed out, agent when signed in
- `app/components/Landing.tsx` — the marketing page and the custom Clerk flow
- `app/components/AgentApp.tsx` — app shell, panels, settings, model choice
- `app/components/ChatView.tsx` — the thread, streaming, image mode
- `app/components/TerminalPanel.tsx` — the shared shell view
- `app/components/ResearchCard.tsx` — the sites a research answer came from
- `app/lib/tools.ts` — every tool the agent can call (source of truth)
- `app/lib/models.ts` — model catalog, known-model list, provider options
- `app/lib/research.ts` — multi-query research and code extraction
- `app/lib/terminal.ts` — sandbox process runner, guard rails, package managers
- `app/lib/workspace.ts` — the per-conversation path jail
- `app/lib/auth.ts` — `requireUser()`, the guard every API route calls
- `proxy.ts` — Next 16 proxy (formerly middleware); mounts Clerk

## Architecture decisions

- **The upstream is stateless.** The Codex transport rewrites every request to
  `store: false`, so no item can be referenced by id on a later turn. Two things
  follow, and both are load-bearing: `providerOptionsFor` always sends
  `store: false` so the AI SDK inlines history instead of emitting
  `item_reference`, and `sanitizeForStatelessReplay` strips reasoning parts and
  provider `itemId`s from replayed assistant turns. Without them, the second
  message of any conversation fails with "Item with id 'msg_…' not found".
- **Auth is checked per resource, not by path.** Clerk deprecated
  `createRouteMatcher` because a path list in the proxy can drift from how Next
  actually routes a request. `proxy.ts` only mounts `clerkMiddleware()`; each
  API route calls `requireUser()` itself.
- **Clerk is optional.** `clerkEnabled` is a build-time check on the publishable
  key. Absent, the provider is not mounted, the proxy passes through, and
  `requireUser()` allows everything — a fresh checkout runs with no setup.
- **Chat history lives in the browser**, next to the encrypted OAuth session.
  The server only ever sees the conversation it is actively answering.
- **The model list is live.** The catalog is read from the user's account per
  page load; `KNOWN_MODELS` only fills gaps and covers the offline case.
- **The terminal transcript is shared.** `lib/terminalBus.ts` is a small
  in-memory store so the panel shows the agent's commands and the user's in one
  scrollback.

## Product

Sign up with Clerk (Google, Apple, or an emailed six-digit code), then connect a
ChatGPT account. Each conversation gets its own sandbox directory. The agent
plans, writes and edits files, runs them, installs and removes packages, clones
repositories, searches and reads the web, extracts code from documentation
pages, and generates images into the workspace. A files panel and a terminal
panel both open onto that same sandbox.

## Gotchas

- **The sandbox is a guard rail, not a security boundary.** `lib/terminal.ts`
  blocks the obvious footguns and `lib/workspace.ts` jails paths, but commands
  run as a normal child process on the server. Anything exposed beyond a trusted
  user should set `AGENT_SANDBOX_COMMAND` to a container wrapper.
- **Effects in `ChatView` are keyed on a content signature, not on the
  `messages` array.** `setMessages` hands back a new array each call, so an
  effect keyed on the array fires on renders where nothing changed, saves,
  re-renders, and loops until React throws "Maximum update depth exceeded". Keep
  new effects keyed on `signature`.
- Image generation is gated separately from chat by ChatGPT plan. A signed-in
  account with working chat can still get a 403 here; that is what the
  `OPENAI_API_KEY` fallback is for.
- Run `pnpm run typecheck` before pushing — `proxy.ts` is included in the agent
  app's tsconfig, so middleware mistakes are caught there.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
