# Creations URL credential validation design

**Date:** 2026-10-20  
**Status:** Approved for implementation scope by user choice

## Goal

When a user registers a website/service URL containing embedded username or password, explain why saving is blocked before sending the request.

## Constraints and assumptions

- Keep the backend `CreationItemBody.validate_url` rule rejecting URL userinfo. Credentials must not be stored in the ordinary creation URL, returned by the creations list API, or passed to thumbnail capture.
- The screenshot's URL has embedded userinfo; the other displayed fields satisfy their current validation rules.
- This change is limited to the Creations form and its existing English and Chinese locale bundles.

## Options

1. Keep the backend rule and add localized client-side detection. This gives immediate, specific feedback with no API or persistence changes. **Chosen.**
2. Support authenticated links by creating explicit credential storage and access behavior. This expands the security and data model scope and was not requested.

## Behavior

Before saving an entry with a URL, parse the URL using the browser URL parser. If it contains a username or password, show a localized explanation that credentials cannot be embedded in the link and ask the user to remove them, then do not send the create/update request. Other URLs follow the existing save path. The backend validation remains authoritative for direct API callers.

## Verification

Add frontend regression tests for both create and edit flows, proving an embedded-credential service URL shows the specific message and sends neither POST nor PUT. Run the Creations page Vitest file and Dashboard TypeScript build. Existing backend URL rejection coverage remains applicable.

## Failure modes and protections

- URL parser rejects malformed values: allow the existing server validation and generic save handling to report them.
- Credentials accidentally reach the API through the form: regression test asserts no save request is sent.
- Client-side validation is bypassed by another caller: existing backend validation still rejects userinfo with 422.

