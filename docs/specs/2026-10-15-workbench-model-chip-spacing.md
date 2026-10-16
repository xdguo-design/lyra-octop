# Workbench Model Chip Spacing

## Goal

Keep composer text visually clear of the selected-model chip in the workbench.

## Design

Set the selected-model chip's bottom margin to 20px. The previous 12px gap still left the textarea text too close to the chip. This adds separation before the textarea while preserving its size, content, and behavior.

## Scope

Update `.wb-composer-model` in `dashboard/src/pages/Home/home-workbench.css` and rebuild the dashboard bundle.

## Verification

Inspect the composer with a selected model and confirm the input text is no longer crowded by the chip. Rebuild the dashboard so the bundled app receives the CSS change.

## Risks

The composer becomes 8px taller than with the previous 12px gap while a model is selected; its existing bottom-anchored layout accommodates this small increase.
