/** Guest capabilities belong to a specific database, not whichever server currently
 * happens to answer localhost. Pin explicitly configured guest endpoints per device.
 * Account requests always use the application's configured API.
 */
export function projectEndpoint(userId: string, defaultUrl: string, storage: Pick<Storage, 'getItem'> = localStorage): string {
  if (!userId.startsWith('guest:')) return defaultUrl
  const pinned = storage.getItem('ron-project-api-url-v1')
  if (!pinned) return defaultUrl
  const url = new URL(pinned)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Invalid private workspace API address. Use an HTTP loopback origin.')
  return url.origin
}