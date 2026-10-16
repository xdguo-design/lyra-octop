# Connector Card Color Consistency

## Goal

Make custom MCP server cards and connector instance cards use the same neutral resting state and blue interaction accent, so the two GitHub cards shown in the connector settings look like parts of one UI.

## Design

- Keep the existing neutral card border and background at rest.
- Use the dashboard brand blue for custom MCP hover and expanded states, matching connector cards' blue interaction accent.
- Use the same brand blue for the custom MCP icon tile; preserve the provider's actual GitHub logo colors.
- Keep connector enable switches, transport badges, status, and card behavior unchanged.
- Do not introduce new settings, theme state, or per-server accent colors.

## Scope

Change the shared connector stylesheet and the custom MCP card accent assignment. Remove the now-unused name-based custom MCP accent helper if it has no other callers. For custom MCP connector instances without a catalog entry, use the existing brand-blue fallback for hover/focus.

## Verification

- Inspect both GitHub card types at rest, hover, and expanded states; confirm gray resting borders and blue accent states.
- Run the dashboard TypeScript project check (`cd dashboard && npx tsc -b`). Do not add or run tests for this style-only change.

## Risks

- Custom MCP cards will no longer have distinct accent colors by server name. This is intentional to make them visually consistent with connector instances.
