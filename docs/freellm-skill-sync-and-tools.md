# LYRA × FreeLLM Skill integration and connector readiness

Implemented on **lyra-octop/dev**. This is a review-gated, two-direction workflow,
not unattended live-site publication.

## Unified resources UI

- `/skill-packages`: full-width resource marketplace with **Experts / Skills / Connectors / Plugins**, search, category filter, featured cards and responsive grid.
- `/skill-packages/manage`: existing local skill-package management (old path preserved by a new URL). Skill browsing no longer requires the side drawer.
- FreeLLM data source: `https://freellm.top/data/skills.json`; only entries whose status is `verified`, GitHub source is HTTPS, and `contentPath` matches their exact `skill-content/<id>.md` are accepted. This means *directory curation*, **not** runtime safety clearance.

## FreeLLM → LYRA

1. Open marketplace → Skills; browse/read the public curated directory.
2. Preview the full, externally sourced `SKILL.md`, source repository and warning.
3. Select a writable local package and explicitly confirm.
4. The service imports *one manifest* under namespaced slug `freellm-<id>`. Existing files are not overwritten by default.
5. The Skill is **not automatically attached to an Agent**; package usage is controlled separately.

The public FreeLLM static repository may change after cache load; there is no permanent streaming connection. Refresh on demand. If the original Skill uses scripts, references, assets or license files not contained in the single mirrored Markdown, they are **not automatically downloaded**. Operators must verify these dependencies.

## LYRA → FreeLLM

1. Open `/skill-packages/manage` and select a package with local Skills.
2. Click "提交 FreeLLM" and choose one Skill; the current complete manifest and SHA-256 are shown.
3. Review for passwords, tokens, patient/user data, confidential material, dependencies, prompt injection, licensing and redistribution rights.
4. Give explicit public-submission consent for that exact digest.
5. Server uses a host-managed GitHub credential to create a new branch and **draft PR targeting `xdguo-design/freellm:dev`**. The proposed content is in `data/lyra-submissions/<slug>.md`.
6. FreeLLM maintainers review provenance and decide whether to curate the Skill into the canonical `data/skills.json` and publish it. No auto-merge or auto-publication.

The submission feature is disabled until the LYRA host securely configures
`FREELLM_SYNC_GITHUB_TOKEN` with an appropriate **least-privilege repository-scoped token**
and approval flow. Never enter this token in the UI, the Agent chat, a Skill manifest, or a public repository. The user must request publication individually; automatically mirroring private Skills is prohibited.

This is two-way **exchange with approval**, not recurring database replication. Catalogue history, conflict resolution, automatic scheduled polling and published-state callbacks are not yet present. Do not label a pending PR as synced/published.

## Tool / MCP readiness

`GET /api/agents/<agent_id>/tool-readiness?mode=craft&selected=<mcp-server-name>`

returns independent statuses:

| Status | Meaning |
|---|---|
| `not_configured` | No matching visible connector instance |
| `not_selected` | Configured but not selected for this turn |
| `authorization_required` | Disabled or missing credentials |
| `mode_blocked` | Ask/Plan mode disables external MCP tools |
| `not_loaded` | Connector selected, but tool registration absent |
| `registered` | Expected tool names loaded, not proof provider calls work |

Gateway probes are separate: on the **Connectors** tab, use "验证" for built-in
mail or "验证工具" for custom MCP such as GitHub. Probe success confirms the
probe's advertised capability and tool discovery only; sending Gmail, pushing
a GitHub commit or invoking other writes requires its own explicit authorized
test and must never be claimed based on a connectivity probe alone.

## Test/verification entry points

- Python: `uv run pytest tests/unit/skills/test_freellm_catalog.py tests/unit/api/test_tool_readiness.py`.
- Lint/type: `make lint`, `make typecheck`.
- Frontend: `cd dashboard && npm run typecheck && npm run build` (use package.json scripts / CI contract).
- Run `make all` before production deployment if the required dependencies are available.

**Live functional acceptance still required with authorized accounts:**
- Ask vs Plan vs Craft selected tool visibility (mail and GitHub).
- Authorized read-only email/connector probe and authorized send/push with HITL.
- Permission isolation for other users and shared Agents.
- FreeLLM import of a verified manifest, duplicate import prevention, manual package mount.
- FreeLLM draft PR submission with a real write-authorized token, double-submit behavior, rejection and confirmation failure paths.

No model should claim successful sending, repository writes, or publishing until the provider returned a verified success payload.
