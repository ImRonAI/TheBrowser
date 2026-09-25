export const auth = { user: { id: 'smoke-user' } }
export const useAuthStore = (select: (state: typeof auth) => unknown) => select(auth)
export const getSession = async () => ({ user: auth.user, access_token: 'synthetic-only' })
export const useProjectsStore = () => ({ userId: auth.user.id, refreshFromServer: async () => ({}) })