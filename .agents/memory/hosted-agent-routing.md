---
name: Hosted agent routing
description: The OpenAI OAuth agent needs a dedicated API prefix when another artifact owns the shared /api route.
---

The agent's server endpoints must use a dedicated `/agent-api` prefix when the workspace already has an API artifact mounted at `/api`.

**Why:** The shared proxy routes `/api` to the existing API artifact before the agent's Next.js routes, producing misleading blank 502 responses.

**How to apply:** Keep the agent's client calls and artifact service paths aligned on `/agent-api`; use Next rewrites to map that prefix to the agent's internal `/api` routes.