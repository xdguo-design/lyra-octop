/**
 * True when the dashboard itself is running inside an iframe — e.g. the
 * workbench 内置平台 shell or the Creations preview embeds same-origin SPA
 * routes (/ppt-studio, /speech-recognition, /ehr, …). Framed pages must render
 * chrome-less: keeping the global nav would let users navigate back to /home
 * and open the platform shell again, nesting iframes without end.
 */
export function isRunningInFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin frame access is denied — treat as framed.
    return true;
  }
}
