# Octop Context Strategy for Multi-Agent Work

**Status:** Design baseline v1 — this document defines the implementation contract; it does not claim that all proposed behavior is already implemented.

**Scope:** Octop conversations, single Agents, team hosts and members, delegated coding/runtime Agents, long-term memory, context compaction, and context-provider plugins.

## 1. Decision summary

Octop must distinguish four things that are currently easy to conflate:

1. **Context** — the bounded information assembled for one model call. It is temporary and model/token-budget dependent.
2. **Conversation history** — the durable sequence of user messages, Agent messages, tool calls, tool results, approvals, and turn events.
3. **Task state** — the authoritative structured plan, assignments, dependencies, status, acceptance criteria, and execution evidence.
4. **Memory** — curated knowledge that may be recalled across turns or sessions, with explicit scope, provenance, confidence, sensitivity, and expiry.

A summary is not the source of truth for task status. Memory is not a substitute for conversation history. A context window is not the place to store the whole project. Agents do not share their private working context by default.

## 2. Existing Octop boundary

The application layer already has a context-window indicator in `dashboard/src/pages/Chat/hooks/useChatContextWindow.ts`, an Agent `max_input_length` setting exposed through `AgentManager.resolve_context_max_tokens()`, per-Agent memory configuration, team host/member routing, and a separate memory management subsystem.

The Agent runtime is built on `octop-harness`. Before replacing its compaction behavior, inspect and use the supported harness extension points; do not introduce a second competing compactor in Octop's request path. The first implementation stage should instrument existing behavior in shadow/observe mode.

Related design:
- [Agent personalization and memory evolution](../agent-personalization-memory-evolution.md)
- [Conversation Todo and multi-Agent collaboration](2026-10-27-conversation-todo-multi-agent.md)

## 3. Non-negotiable principles

- **Scope before retrieval:** authorize the scope first, then retrieve. Similarity score never grants access.
- **Minimum necessary context:** pass only what the next Agent/task needs, not the whole parent transcript.
- **One source of truth:** task state is structured server-side data with revisions; summaries and UI checkboxes cannot silently overwrite it.
- **Lossless state, lossy prose:** compress old conversational narration when necessary, but preserve task IDs, statuses, decisions, approvals, blockers, constraints, and evidence references as structured data.
- **Provenance everywhere:** recalled facts and project snippets carry source IDs, timestamps/version, and trust labels.
- **Private by default:** an Agent's persona notes, private memory, credentials, and unrelated conversations are not automatically shared with team members or external executors.
- **Explicit extension activation:** external memory/context plugins are opt-in, versioned, scoped, and observable. Plugin failure falls back safely without bypassing access checks.
- **No false completion:** a task becomes completed only after its acceptance criteria and required evidence have been checked.

## 4. Context scopes and ownership

| Scope | Owner / authority | Default use |
|---|---|---|
| Platform policy and tool permissions | Platform | Always present; never overridden by retrieved text |
| User preferences | User memory | Inject only when relevant; exclude secrets and temporary task instructions |
| Project knowledge | Project/workspace | Reusable project instructions, decisions, architecture, files and conventions; project-isolated |
| Conversation | Conversation/thread | Recent dialogue, current intent, approvals, unresolved questions |
| Team plan | Team task service; host coordinates | Shared goal, task graph, assignments, accepted decisions, dependency status and blockers |
| Agent working context | Individual Agent/thread | Its own reasoning history and tool chain; private unless explicitly shared |
| Task packet | Assigning host / task service | Minimum bounded input for one delegated task |
| Evidence/artifacts | Producing run or tool | Full logs, diffs, files and large outputs stored by reference; summaries are not the evidence |

Team members may update only the tasks they are assigned and fields they are permitted to change. They must not replace the entire team plan. All task mutations carry a revision; stale writes are rejected or explicitly reconciled.

## 5. Per-turn context assembly

Build one `ContextPacket` per model call in this order:

1. **Immutable policy layer:** platform safety, permissions, Agent role, tool restrictions, and trusted project instructions.
2. **Active request layer:** latest user request, explicit constraints, current approval/HITL state, and unresolved questions.
3. **Task-state layer:** authoritative task/plan revision, assigned task, acceptance criteria, dependencies, latest status and blockers.
4. **Recent interaction layer:** the most recent complete turns and the active tool-call/result chain, preserving ordering.
5. **Retrieved context layer:** only relevant memories, project files, decisions, skills and previous task results that pass scope and sensitivity checks.
6. **Artifact references:** links/IDs to large tool output, logs, code diffs, images and documents; include small excerpts only when needed.
7. **Output reserve:** leave enough context capacity for the model's expected answer/tool calls and provider-specific overhead.

Every included item should carry `source_id`, `scope`, `trust_level`, `sensitivity`, `observed_at`, `revision` (when applicable), and a reason for inclusion. Retrieved documents and tool outputs are untrusted data, not instructions. Keep a stable system/policy prefix and append changing retrieval results after it to reduce unnecessary prompt-cache misses.

### Token-budget rule

Compute the effective input cap per request from the selected model's actual context window, the Agent's configured `max_input_length`, output-token reservation, and a safety margin:

`effective_input_cap = min(model_context_window - output_reserve - safety_margin, configured_input_cap_if_set)`

If the provider does not publish a trustworthy context window, use an explicit conservative fallback and expose that the value is estimated. Do not assume every model has 128k tokens. Count/estimate tokens at the backend; the frontend context ring is observability, not enforcement.

Prioritize in this order when the cap is approached:
1. policy and permissions;
2. current user request and approvals;
3. task contract, task statuses, decisions and blockers;
4. recent turns and active tool chain;
5. relevant project knowledge and memory;
6. older dialogue and low-relevance material.

Large tool outputs must be persisted as artifacts and summarized with stable references, not pasted into every subsequent prompt.

## 6. Compaction and recovery

Compaction is a controlled transformation, not deletion of the transcript.

- Use configurable soft-warning, compaction, and emergency thresholds against the effective input cap. Initial target defaults for evaluation: warn near 70%, compact near 82%, emergency recovery near 92%; tune per provider/model from measured telemetry.
- Before compressing, create a structured checkpoint containing current goal, task/plan revision, completed and pending task IDs, accepted decisions, explicit user constraints, pending approvals, blockers, tool/run IDs, artifact references, and next action.
- Preserve the most recent complete turns and any unresolved tool/HITL cycle.
- Summarize older prose into a versioned checkpoint with source message/event IDs. Do not infer missing facts; mark uncertainty as unknown.
- Keep the original history and artifact payloads addressable. Compaction must not destroy the audit trail.
- After compaction, validate that all active task IDs/statuses, decisions, approvals, and blockers in the checkpoint match the authoritative task store.
- If compaction fails, keep the existing context and stop/reduce optional retrieval rather than silently discarding the task contract.

The current runtime already depends on `octop-harness`; confirm its compaction lifecycle and supported hooks before enabling any replacement engine.

## 7. Multi-Agent delegation protocol

A child Agent should start from a **fresh bounded context**, not inherit the parent conversation wholesale. This follows the useful Hermes delegation pattern: a child knows only the goal/context explicitly passed to it, plus permitted workspace/project instructions; its result is returned to the parent as a structured handoff.

### TaskEnvelope (parent → child)

Required fields:

- `schema_version`, `task_id`, `parent_task_id`, `plan_id`, `plan_revision`
- `team_id`, `assignee_agent_id`, `requesting_agent_id`
- `goal`, `scope_in`, `scope_out`, `constraints`
- `acceptance_criteria`, `depends_on`, `deadline` / budget when applicable
- `workspace_ref` (repo/branch/path or project document IDs)
- `context_items[]` (small excerpts plus stable source refs and trust labels)
- `allowed_tools` / write boundaries / network constraints
- `input_token_budget`, `output_token_budget`, `revision`

Do not include another Agent's private memory, unrelated conversation history, raw credentials, or unredacted logs. Resolve file and memory permissions server-side; a prompt field alone is not an authorization mechanism.

### TaskHandoff (child → parent)

Required fields:

- `task_id`, `status`, `summary`, `completed_criteria[]`
- `decisions[]` with rationale and source references
- `artifacts[]`, `changed_files[]`, `test_evidence[]` / run IDs
- `blockers[]`, `risks[]`, `next_actions[]`
- `memory_candidates[]` (suggestions only, not automatic permanent memory)
- `context_delta` (new facts/decisions the parent needs, with provenance)
- `updated_plan_revision` or the revision on which the work was based

The parent verifies the handoff and evidence, updates the shared task store, and then gives the next Agent a new envelope. Do not return every child tool call to the parent's prompt; retain the full trace in the run record and return only relevant findings and artifact references.

## 8. Memory policy

Keep the built-in memory and any optional external memory provider additive, not competing authorities.

Memory categories:
- **User:** stable preferences and explicitly requested durable facts.
- **Project:** verified conventions, architecture decisions and project facts.
- **Agent/procedural:** validated reusable methods and role-specific operating rules.
- **Episodic:** task outcomes, failures and feedback with task/run references.
- **Team:** accepted shared decisions and lessons approved for team reuse.

Every memory item should have `owner`, `scope`, `source_event_id`, `confidence`, `sensitivity`, `observed_at`, optional `expires_at`, `supersedes_id`, and `status` (candidate/approved/active/deprecated). One-off instructions, unverified claims, raw tool output and secrets must not be promoted to permanent memory. Corrections supersede older entries rather than creating silent contradictions. Memory extraction should happen at explicit lifecycle points (task/session completion or configured cadence), not blindly after every message.

External providers receive only redacted data. Retrieval is scoped before search and returns source references. Provider data is never allowed to change platform policy or permissions.

## 9. Plugin architecture inspired by Hermes

Borrow the separation of concerns rather than copying implementation details:

- **Context engine (one active engine per Agent instance):** model-aware token accounting, context selection, compaction/checkpointing, and lifecycle handling. Default remains the existing harness behavior until an alternative is explicitly selected.
- **Memory provider (built-in plus at most one configured external provider in the first version):** scoped recall, candidate storage, turn synchronization and optional session-end extraction.
- **General context hooks:** `before_context_assembly`, `after_turn_commit`, `before_delegate`, `after_delegate`, `before_compaction`, and `after_compaction`. Hook output is source-labeled, size-limited, secret-scrubbed and unable to bypass authorization.
- **Per-Agent isolation:** mutable budgets and session state are per Agent/thread. A registered plugin may share a durable backend, but each Agent receives an independent runtime instance.
- **Explicit activation and fallback:** no automatic activation of third-party context engines; validate plugin compatibility, schema and permissions. On failure, fall back to the built-in path and emit an audit event.
- **Cache stability:** keep the stable policy prefix unchanged when possible. Context selection that reorders messages every turn can destroy prompt-cache reuse.

Hermes reference material:
- Context engine plugin and compaction lifecycle: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/context-engine-plugin.md
- Context compression and caching: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/context-compression-and-caching.md
- Isolated delegation and explicit child context: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/delegation.md
- Memory providers and prefetch/sync lifecycle: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md
- DeepSeek's Hermes integration guide: https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/hermes/

## 10. Observability and user control

For each model call, record low-risk metadata: model/context limit, estimated and actual token usage where available, included source IDs, omitted items/reasons, retrieval latency, compaction reason/version, and plugin identity. Do not store full prompt content in telemetry by default.

The workbench should eventually expose a **Context Inspector** with:
- current effective budget and estimated usage;
- which layers/items were included and why;
- memory/document provenance and scope;
- compaction/checkpoint timestamp and revision;
- what was omitted because of token budget;
- controls to exclude a memory, clear task-local context, or disable an optional provider.

The inspector must not expose another Agent's private context or raw secret-bearing tool output.

## 11. Implementation plan and gates

### P0 — Contract and baseline (this document)
- Confirm ownership/scope vocabulary and delegation packet.
- Document the current harness boundary.
- No runtime behavior change.

### P1 — Context telemetry and assembler in shadow mode
- [x] Add a pure, testable budget calculator that clamps the Agent input cap to the model window after output reserve and safety margin; unknown model windows are explicitly marked as fallback estimates.
- [x] Add a delegation context-packet validator for scope, trust, sensitivity, bounded excerpts, raw-secret/transcript fields, and aggregate token budget.
- [x] Add metadata-only model-call middleware. It records estimated text-token usage, bounded source IDs, source roles, model/window metadata and pressure level without changing messages or logging prompt content.
- [ ] Compare estimates with provider-reported usage on representative models; the current estimate is intentionally heuristic and multimodal payloads are counted separately.
- [ ] Integrate supported harness lifecycle hooks for actual omission reasons and compaction events. The model-call middleware cannot see content discarded before it receives the request, so it explicitly reports this observability boundary rather than inventing data.
- Gate: model-specific budget tests and no cross-scope retrieval tests pass.

### P2 — Structured task context for team Agents
- Persist task plan/revision/assignment/dependencies as authoritative server-side state.
- Add TaskEnvelope/TaskHandoff validation and optimistic concurrency.
- Each Agent updates only permitted task fields.
- Gate: member A cannot read or overwrite member B's private context or task state; stale revisions are rejected.

### P3 — Context compaction/checkpoint adapter
- Integrate with the supported `octop-harness` lifecycle rather than running a second compactor.
- Preserve structured task state and source-linked artifacts across compaction.
- Gate: long-run replay tests preserve task status, approvals, decisions and blockers.

### P4 — Optional context/memory plugins
- Define a versioned plugin contract and explicit settings.
- Start with one optional provider adapter; redact secrets and enforce scope server-side.
- Gate: provider outage falls back safely; no unauthorized memory is injected.

### P5 — Context Inspector and operational tuning
- Add UI visibility, exclusion controls and measured threshold tuning.
- Roll out behind a feature flag; compare success rate, repeated questions, context-related failures, token cost and latency before enabling by default.

## 12. Acceptance checklist

- [ ] Context assembly is bounded by the selected model and Agent configuration.
- [ ] User request, permissions, task contract and pending approvals survive compaction.
- [ ] Every retrieved item has scope and provenance; access is checked before retrieval.
- [ ] Child Agents receive explicit bounded envelopes, not full parent history.
- [ ] Team task writes are revisioned; no last-write-wins replacement of a whole plan.
- [ ] Private Agent memory and unrelated projects are not shared by default.
- [ ] Large tool outputs are stored by reference and summarized with evidence links.
- [ ] Secret scrubbing runs before any external provider or plugin receives context.
- [ ] Plugin failures cannot disable access checks or silently delete context.
- [ ] Tests cover long histories, model-window variation, compaction, concurrent updates, cross-scope leakage, prompt injection and provider outage.
