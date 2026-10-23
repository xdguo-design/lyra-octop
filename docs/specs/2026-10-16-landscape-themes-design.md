# Landscape Themes Design

## Goal

Add seven scenery-led visual themes to the dashboard. The selected theme must keep its landscape image visible on the workbench instead of reducing the theme to an accent color.

## Scope

- Preserve all existing visual themes and add `clearSky`, `cloudSea`, `greatWall`, `mogaoCaves`, `changbaiMountain`, `woodland`, and `bambooForest`. `woodland` is the new woodland theme ID because `forest` already names the existing “松林呼吸” theme.
- Use one project-local landscape asset for both the workbench theme card and selected workbench background.
- Give each theme matching light/dark surface tokens, borders, radii, and legible translucent work surfaces. Brand palette remains independent.
- Keep both theme entry points in sync: the Workbench settings gallery and the account `ThemeGallery`.
- Keep theme preference persisted through the existing `ThemeContext` / appearance storage.

## Data flow

Theme card click calls the existing `setSkin(id)`. `ThemeContext` persists the ID and exposes it as `html[data-skin]`. Both galleries use a shared theme definition and the Home workbench applies that definition's artwork as its background; existing `skinAntdTokens` supplies matching Ant Design surface tokens.

## Failure cases and mitigations

- Unknown stored IDs: existing appearance validation falls back to the default skin.
- Background image obscures controls: keep side rail and cards on readable opaque or translucent surfaces, with a subtle image wash behind content.
- Image asset fails to load: theme colors and workbench surfaces remain usable as CSS background-color fallback.
- Light/dark mismatch: define both palettes for each new skin and test both modes.

## Verification

- Typecheck/build dashboard.
- Verify each new theme appears in both galleries and toggling it changes the persisted skin ID.
- Visually verify at least one sky scene and one landmark/forest scene, in light and dark modes, while checking text and card contrast.
