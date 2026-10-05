/** Panel Live and the teaching agent use the same explicitly configured API. */
export function liveApiBase(configured: string | undefined, fallback: string): string {
  const url = new URL(configured?.trim() || fallback)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Live API must be an HTTP(S) base URL without credentials, query or fragment.')
  }
  return url.toString().replace(/\/$/, '')
}

export function liveSocketUrl(base: string, path: string): string {
  const url = new URL(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export async function checkLiveApi(base: string, request: typeof fetch = fetch): Promise<void> {
  let response: Response
  try {
    response = await request(`${base}/bidi/settings`, { signal: AbortSignal.timeout(5000) })
  } catch {
    throw new Error(`Cannot reach the Live agent backend at ${base}. Start the current backend before connecting.`)
  }
  if (response.status === 404) {
    throw new Error(`The backend at ${base} does not include the Live or learning agent routes. Run npm run electron:dev or deploy the current API to that host.`)
  }
  if (!response.ok) throw new Error(`Live agent backend check failed (${response.status}) at ${base}.`)
  const settings: unknown = await response.json()
  if (!settings || typeof settings !== 'object' || !('models' in settings) || !Array.isArray(settings.models)) {
    throw new Error(`The endpoint at ${base} did not return Live agent settings.`)
  }
}
