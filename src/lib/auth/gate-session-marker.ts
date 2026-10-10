/**
 * Marker for a session created from an identity header. Signing out of that
 * session does nothing useful if the next request creates it again, so the
 * user button hides its sign-out control when this cookie is present.
 * `__Host-` cookies cannot carry a Domain, so another site cannot plant one.
 */
export const GATE_SESSION_MARKER_COOKIE = "__Host-gate_session";

export function hasGateSessionMarker(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((pair) => pair.trim().startsWith(`${GATE_SESSION_MARKER_COOKIE}=`));
}
