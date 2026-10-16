# Website thumbnail capture for Creations

## Goal

When a user saves a deployed website in Creations, show a screenshot of its public home page in the card. If capture is unavailable or unsafe, keep the entry and use the existing default service thumbnail.

## Scope and behavior

- Capture only `service` entries with an HTTP(S) URL; do not capture GitHub repository cards or platform plans.
- Capture after create and after an edit that changes the URL. Use a fixed 1280×800 viewport, no login/session state, a 15-second overall deadline, and a compressed JPEG. Keep the captured first viewport, not the full page.
- Store the image under the Octop data root, partitioned by owner and item ID. Do not add a database column or migration; return a thumbnail API URL only when a file exists.
- Serve thumbnails through the authenticated Creations API and check that the requested item belongs to the current user.
- A missing browser, timeout, navigation error, unsafe destination, or capture failure must not fail the save. Remove a stale image on failed recapture so the frontend uses its default icon. Delete the image with its item.
- The dashboard loads the API image through the existing authenticated image component.

## Safety and limits

- Use a fresh headless browser context with no cookies, credentials, storage state, or service workers.
- Force all browser egress through a short-lived local proxy. The proxy permits only HTTP(S), resolves each target, rejects the connection if any resolved address is not globally routable, and connects directly to one of the checked IPs so DNS rebinding cannot change the destination after validation. Redirects and subresources use the same proxy; direct egress and non-HTTP(S) requests are blocked.
- Cap viewport, total time, transferred bytes, image size, and concurrent browser captures; store only the resulting JPEG. Capture errors are non-fatal and do not expose internal error details to the client.

## Alternatives considered

1. Screenshot locally with Playwright (selected): reuses the installed browser dependency and keeps page contents on the Octop host.
2. Fetch Open Graph metadata: simpler and cheaper, but does not meet the requested first-screen screenshot behavior.
3. Use a remote screenshot service: fewer local browser requirements, but sends user URLs to a third party and adds a dependency.

## Verification plan

- Inspect create, URL-edit, unchanged-URL edit, delete, and failed-capture paths.
- Check private/loopback/link-local IP literals, hostnames resolving to non-public IPs, redirects, and unsafe subresources are rejected.
- Run dashboard typecheck/build and backend lint/typecheck as feasible; no test suite will be added or run unless requested.

## Known limitation

The browser binary must be installed for screenshots to appear. Sites requiring login, or sites whose public resources are blocked by the destination checks, use the default thumbnail.
