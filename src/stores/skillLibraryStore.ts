import { create } from 'zustand'

/**
 * Opens an agent's Skill library (the Teach Ron studio's list of `GET /teaching/skills`) from elsewhere,
 * e.g. after a page is published as a skill. The studio for `agentId` opens with the library expanded.
 */
interface SkillLibraryState {
  request: { agentId: string; skillId: string | null; nonce: number } | null
  show: (agentId: string, skillId?: string | null) => void
}

export const useSkillLibraryStore = create<SkillLibraryState>((set, get) => ({
  request: null,
  show: (agentId, skillId = null) => set({ request: { agentId, skillId, nonce: (get().request?.nonce ?? 0) + 1 } }),
}))
