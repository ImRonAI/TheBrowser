/**
 * The URL to load for an address typed without a scheme. Electron's `loadURL` needs one, and `new URL('example.com')`
 * throws, so a bare host gets one the way a browser's address bar adds it: `http://` for localhost and IP literals
 * (local servers rarely speak TLS), `https://` for everything else. An address that already names a scheme
 * (`https://…`, `ron://…`, `file://…`) or is an `about:`, `data:` or `mailto:` URL comes back unchanged.
 *
 * Pure (no `@/` imports): the address bar and Electron's `browser:navigate` handler both use it, and
 * `node --experimental-strip-types` runs the colocated test.
 */
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i
const SCHEME_WITHOUT_SLASHES = /^(about|data|mailto):/i
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-f:.]+\])(:\d+)?([/?#]|$)/i

export function toNavigableUrl(input: string): string {
  const address = input.trim()
  if (!address || HAS_SCHEME.test(address) || SCHEME_WITHOUT_SLASHES.test(address)) return address
  // A scheme-relative address (`//example.com/a`) only lacks the scheme itself.
  if (address.startsWith('//')) return `https:${address}`
  return `${LOCAL_HOST.test(address) ? 'http' : 'https'}://${address}`
}
