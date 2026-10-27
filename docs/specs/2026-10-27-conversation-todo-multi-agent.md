# Conversation Todo and Multi-Agent Collaboration

**Context strategy:** see [Octop Context Strategy for Multi-Agent Work](2026-10-27-octop-context-strategy.md). Task packets, context scopes, compaction, memory governance and plugin lifecycle must follow that contract.

## Goal

Treat the Todo panel as an interaction surface between the user, the current Agent, and (in team rooms) the owning team member. It must not imply that separate Agent-local plans are already one globally shared plan.

## Current implementation boundary

- A `write_todos` list belongs to the Agent that emitted the tool call.
- Team-room messages are grouped by speaker. Each member's Todo list remains in that member's speaker group.
- The team host is an orchestrator and uses `ask_agent`; it does not own a member's `write_todos` list.
- The panel labels member-owned lists and routes an edit back through the team host to the matching member.
- A member edit must not overwrite the host's orchestration plan or another member's list.
- A one-to-one chat keeps the existing target-agent selection behavior.

## Interaction contract

1. The Agent may create and update its own Todo list through `write_todos`.
2. The page identifies the speaker that owns the displayed list.
3. A user edit sends the current list, in order, with explicit statuses.
4. For a team member list, the host receives the owning member ID and is instructed to use `ask_agent` to send the change to that member. The member updates its own list and resumes unfinished work.
5. While a team turn is active, edits remain drafts and cannot be synchronized until the active turn is idle.
6. Completion is based on execution and verification, not on a user checkbox or a model's unverified assertion.

## Multi-Agent design for the next phase

The UI-level routing above is not a shared task scheduler. A full team-wide plan requires a server-owned task contract, rather than merging independent `write_todos` tool calls.

Recommended shared task record:

- `plan_id`, `task_id`, `title`, `status`
- `assignee_agent_id` and optional reviewer Agent
- `depends_on` task IDs
- `acceptance_criteria`
- `revision` for optimistic concurrency
- `run_id` / execution evidence references
- `updated_by_agent_id`, timestamps, and an append-only change event

The host owns the team plan and assignment graph. Each member owns progress updates for its assigned tasks. The server validates membership, dependency transitions, and revisions; the UI renders the shared plan plus per-Agent execution lanes. If two Agents edit the same revision, reject or reconcile the conflict explicitly instead of silently taking the last write.

## Acceptance tests

- Editing a member list targets that member and preserves its ownership.
- A team host's plan is not editable as if it were a member's `write_todos` list.
- Member A's plan update does not replace member B's list.
- Solo chat still preserves its selected target-agent behavior.
- Chinese and English labels are available.
- Targeted frontend tests, type-check, and production build pass before offline acceptance.
