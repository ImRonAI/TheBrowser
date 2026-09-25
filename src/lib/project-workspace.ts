/** A device-local capability, not an account or a shared anonymous user. */
export function guestWorkspace(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  const key = 'ron-project-workspace-v1'
  let token = storage.getItem(key)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    storage.setItem(key, token)
  }
  return { id: `guest:${token}`, name: 'You', token }
}