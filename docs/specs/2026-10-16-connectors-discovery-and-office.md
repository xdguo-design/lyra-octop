# Connector discovery and office integrations

## Goal

Make the built-in Connectors catalog easier to find things in, and add useful office integrations with a real authentication and MCP path. Keep the existing Enabled and Custom tabs and existing connector configuration behavior.

## Current facts

- The built-in catalog contains 27 entries and already has Tencent Docs/Meeting/Weiyun, Feishu CLI, WeCom CLI, and personal mail. Do not duplicate these.
- The built-in view currently renders the complete catalog without a search or category filter.
- Connector instances and their credentials are scoped to an Octop user.
- WPS 365 exposes separate official Streamable HTTP MCP endpoints; each accepts a user access token in `Authorization: Bearer …`. Catalog credential validation already stores `personal_token`, but remote MCP assembly currently has no generic `personal_token + mcp_url` path; the builder must be extended.
- DingTalk's official `dws` CLI supports multiple profiles, but its login material is stored by the host CLI. Octop would need a user-isolated login/storage lifecycle before a built-in multi-user connector could safely invoke those profiles. A global host profile or an arbitrary profile string is not sufficient isolation.

## Proposed changes

### Built-in catalog filters

- Add a keyword input and a category selector above the built-in connector grid.
- Search localized name, description, kind, and category. Match case-insensitively in the active UI locale; selecting a category combines with the keyword using AND.
- Keep the current total/configured summary; show the filtered result count beside the controls.
- Provide a localized empty state and a clear-filters action. Filters are local to the Built-in tab and reset when leaving the page.
- Do not change Enabled or Custom tabs.

### WPS 365 connectors

Add four distinct official remote MCP entries, because WPS publishes separate service endpoints and permission scopes:

| Connector | Endpoint | Scope |
|---|---|---|
| WPS Cloud Docs | `https://openapi.wps.cn/mcp/v2/kso-yundoc/message` | `delegated:kso.mcp_yundoc.readwrite` |
| WPS Calendar | `https://openapi.wps.cn/mcp/v2/kso-calendar/message` | `delegated:kso.mcp_calendar.readwrite` |
| WPS Mail | `https://openapi.wps.cn/mcp/v2/kso-mail/message` | `delegated:kso.mcp_mail.readwrite` |
| WPS Personal To-do | `https://openapi.wps.cn/mcp/v2/kso-todo/message` | `delegated:kso.mcp_todo.readwrite` |

- Store each user's access token as a secret credential; use `streamable_http` and the existing remote MCP transport.
- Extend remote MCP assembly to allow a catalog-defined URL with `auth_kind=personal_token`, forwarding the token only as a Bearer header. Keep URL selection catalog-controlled; do not accept a user-supplied endpoint for these built-ins.
- Each entry gets its own localized name, description, auth hint, guide URL, category `office`, and endpoint.
- Expose upstream tools as documented by WPS. Mail includes sending a prepared draft; calendar, to-do, and docs include write/share operations. The access token's scope is enforced upstream; the card's guide must explain each permission grant and material side effects.
- The user must register a WPS 365 app, request the service permission, obtain a user access token, and disable interface request signing (not currently supported by the MCP endpoint), as specified by WPS.
- Add the four entries to `docs/connectors.md` in catalog order.

### DingTalk scope

Do not add a `dws` connector in this change. Although the official CLI provides real office operations, its host-level profile store does not currently map safely to Octop's per-user connector credentials. Add DingTalk after a user-scoped authorization/storage path is designed; do not ship a placeholder or a shared account card as if it were safely available.

## Alternatives considered

1. Add search/filter only. Smallest UI diff, but leaves the user's explicit request for more office integrations unanswered.
2. Add search/filter plus direct WPS MCP entries. Uses Octop's existing per-user secret storage and remote Streamable HTTP transport, so it requires no new backend architecture.
3. Add the DingTalk CLI immediately. It offers broader functions, but host-level CLI identities could cross user boundaries; reject until the authorization lifecycle is isolated.

Choose option 2 for this implementation.

## Failure and safety cases

- Search with mixed case, Chinese/English locale, empty query, and no matches: only the visible built-in results change; the empty-state clear action restores all entries.
- A WPS token is missing, expired, or lacks the specific delegated scope: connector probe/call reports the upstream authorization failure; tokens remain user-scoped and are never included in catalog metadata or logs.
- A WPS operation can send a prepared email or modify/share records: the tool descriptions and connector guide make those side effects clear; no broad credential is shared across users.
- WPS upstream changes an endpoint or permission scope: keep endpoint/scope in one catalog entry and verify against the official page before listing it as available.
- One service's permissions are not approved: other WPS services remain independent because each is a separate connector and token instance.

## Implementation and verification map

- `dashboard/src/pages/Agent/Connectors/index.tsx`: built-in-tab search, category selection, filtered count, empty state.
- `dashboard/src/locales/{en,zh}.json`: localized labels.
- `src/octop/infra/connectors/catalog.json`: four WPS MCP entries.
- `docs/connectors.md`: keep the human catalog synchronized.
- Reuse existing remote MCP, per-user encrypted credential, and Streamable HTTP paths; no schema or dependency changes.
- Verify catalog parsing, relevant connector/API behavior, dashboard typecheck, and review the rendered built-in tab.

## Sources checked

- DingTalk official CLI: <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli>
- WPS integration guide: <https://open.wps.cn/documents/app-integration-dev/mcp-server/use-guide>
- WPS Cloud Docs tools and scope: <https://open.wps.cn/documents/app-integration-dev/mcp-server/tools/mcp_kso-yundoc>
- WPS Calendar tools and scope: <https://open.wps.cn/documents/app-integration-dev/mcp-server/tools/mcp_kso-calendar>
- WPS Mail tools and scope: <https://open.wps.cn/documents/app-integration-dev/mcp-server/tools/mcp_kso-mail>
- WPS To-do tools and scope: <https://open.wps.cn/documents/app-integration-dev/mcp-server/tools/mcp_kso-todo>
