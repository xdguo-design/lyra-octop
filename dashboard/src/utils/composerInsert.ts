/**
 * Bridge that lets a non-chat surface (e.g. the browser panel's "select page
 * element" tool) append text to the chat composer without importing the chat
 * page — `components/` must not depend on `pages/`.
 *
 * The composer subscribes on mount; text produced while no composer is mounted
 * is buffered and flushed on the next subscription.
 */
type ComposerInsertListener = (text: string) => void;

const listeners = new Set<ComposerInsertListener>();
let pendingText = "";

/**
 * Append text to the chat composer.
 *
 * Returns `false` when no composer is mounted — the text is buffered and
 * applied as soon as one subscribes.
 */
export function insertComposerText(text: string): boolean {
  const chunk = text.trim();
  if (!chunk) return false;

  if (listeners.size === 0) {
    pendingText = pendingText ? `${pendingText}\n\n${chunk}` : chunk;
    return false;
  }
  for (const listener of listeners) listener(chunk);
  return true;
}

/** Subscribe a composer; returns the unsubscribe function. */
export function subscribeComposerInsert(
  listener: ComposerInsertListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Take (and clear) text buffered while no composer was mounted. */
export function consumePendingComposerInsert(): string {
  const value = pendingText;
  pendingText = "";
  return value;
}

/** Test helper: forget subscribers and buffered text. */
export function resetComposerInsert(): void {
  listeners.clear();
  pendingText = "";
}
