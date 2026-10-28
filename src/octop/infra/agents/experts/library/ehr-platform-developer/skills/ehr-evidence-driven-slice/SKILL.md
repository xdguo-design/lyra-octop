---
name: ehr-evidence-driven-slice
description: Build or review one EHR feature from approved requirements, site-version evidence, service contracts, and current code. Use for HIS PRD, prototype, frontend, API, application, domain, or acceptance work.
---

# EHR 证据驱动纵向切片

## 1. 建立事实基线

- Read project instructions, repository `AGENTS.md`, `memory.md` if present, the owning service README, and relevant OpenAPI/event contracts.
- Locate the exact PRD revision, prototype page, and target-site evidence. Record paths, section/line references, and source versions.
- Classify every business statement as `VERIFIED`, `PROPOSED`, or `UNKNOWN`.
- Treat the target site's current 020 release as the user's confirmed factual baseline. Keep 003/020 conflicts pending until a business decision resolves them.
- If source evidence or repo write access is missing, stop before claiming implementation and report the missing input/capability.

## 2. Trace the requested outcome

Create a compact table for the requested requirement IDs:

| Requirement / AC | PRD evidence | Prototype interaction | Frontend | API / event contract | Application | Domain rule | Test |
|---|---|---|---|---|---|---|---|

Mark each absent layer `MISSING`; do not fill it with guessed behavior. Identify which open questions actually block the requested slice and which can be implemented independently.

## 3. Implement only confirmed behavior

- Preserve dirty user changes and the repository's module boundaries.
- Put business rules in the domain/application layers; keep HTTP adapters thin and validate inputs at the boundary.
- Add or update the contract before consumers when a service owns that API. Never edit another owner's checkout without explicit scope.
- For unresolved charging rules (money/rounding, insurance breakdown, payment compensation, refunds, receipts, shift close, concurrency locks, or registration-free patient creation), preserve `UNKNOWN` and state the responsible owner plus closure criterion.
- Real insurance, payment, and receipt integrations remain TODO without a signed contract and live test environment. Never manufacture a successful response.
- Keep tests tied to requirement/acceptance IDs and cover a normal path plus relevant failure/idempotency/concurrency edges.

## 4. Keep the model and product in sync

After changing real frontend behavior, update the corresponding interactive PRD prototype to match its layout, controls, validation, loading/empty/error states, and service status. Re-check both directions: every prototype control maps to real code/contract, and every implemented user-visible action appears in the prototype. Prototype/mock data must be visibly labeled and must never imply a production transaction succeeded.

## 5. Verify and report

- Run the owning service's required build/tests and the affected frontend typecheck/tests. Capture exact commands and exit results.
- Re-check `git diff` for unrelated changes, leaked test credentials, hard-coded secrets, or accidental edits outside the target repo.
- Report the requirement-to-file/test mapping, validation evidence, unresolved `UNKNOWN`/TODO items, and whether changes landed in an isolated project worktree.
- Never push, merge, deploy, or connect real financial/insurance systems automatically.
