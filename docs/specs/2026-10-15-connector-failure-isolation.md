# Default MCP Failure Isolation

## Goal

Allow a chat turn to continue with available tools when an unrelated default-open MCP connector fails to load. A broken Vercel connection must not prevent use of a successfully loaded Mail connector.

## Behavior

- MCP servers explicitly selected for the current turn remain required, including when also default-open. If one fails to load, return the existing `CONNECTOR_MCP_LOAD_FAILED` error.
- Failed servers added only through defaults are omitted from the turn; successfully loaded servers remain available.
- `explicit=None` means use defaults without user-selected required servers; an explicit list identifies the required selections.
- Log skipped default servers with their names so connector failures remain diagnosable.
- The dashboard chat-turn validation path remains strict for explicitly selected MCP servers.

## Scope

Update `GlobalProcessor._resolve_turn_mcp_servers` in `src/octop/infra/gateway/process/processor.py`. It already receives both the explicit server list and the merged list, and `prepare_chat_mcp` returns the failed names. Preserve the explicit-empty-list opt-out semantics. Do not change OAuth, connector settings, or tool-loading behavior.

## Verification

Review the dashboard and IM call paths and the existing processor default-open tests. Do not run tests unless requested.

## Risks

When a default connector is unavailable, a turn can proceed without its tools. Keep this limited to default-added servers; explicitly selected connector failures must continue to stop the turn with an error.
