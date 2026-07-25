/**
 * Rewrites incoming deep links into app routes.
 *
 * Shareable invite links are WebBaseURL/a/<code> (e.g. https://photu.app/a/QRKHPWN9) —
 * a web URL, so it unfurls in a chat and opens the browser for someone without the
 * app. When the app IS installed, the OS hands that path here via a Universal/App
 * Link, and this maps /a/<code> to the in-app /join/<code> landing.
 *
 * Anything unrecognised is returned unchanged so expo-router resolves it normally.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // `path` may be a full URL (cold start via a link) or an app path (warm nav).
    const pathname = path.startsWith('http') ? new URL(path).pathname : path
    const match = pathname.match(/^\/a\/([A-Za-z0-9]+)\/?$/)
    if (match?.[1]) {
      return `/join/${match[1].toUpperCase()}`
    }
  } catch {
    // A malformed URL is not worth crashing the launch over — fall through.
  }
  return path
}
