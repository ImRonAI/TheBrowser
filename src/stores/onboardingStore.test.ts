import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  },
})

const { INTERVIEW, useOnboardingStore } = await import('./onboardingStore.ts')

beforeEach(() => {
  storage.clear()
  useOnboardingStore.getState().resetOnboarding()
})

const firstQuestion = INTERVIEW[0]?.question ?? ''
const secondQuestion = INTERVIEW[1]?.question ?? ''

test('startRedo backs up answers and completion, and cancelRedo restores them', () => {
  const store = useOnboardingStore.getState()
  store.setAnswer(firstQuestion, 'AI news')
  store.setAnswer(secondQuestion, 'TypeScript, Design')
  store.completeOnboarding()

  assert.equal(useOnboardingStore.getState().isComplete, true)
  assert.equal(useOnboardingStore.getState().answers.length, 2)

  useOnboardingStore.getState().startRedo()
  assert.equal(useOnboardingStore.getState().isComplete, false)
  assert.equal(useOnboardingStore.getState().answers.length, 0)
  assert.equal(useOnboardingStore.getState().currentStep, 'interview')
  assert.equal(useOnboardingStore.getState().currentQuestionIndex, 0)
  assert.equal(useOnboardingStore.getState().redoBackup?.isComplete, true)
  assert.equal(useOnboardingStore.getState().redoBackup?.answers.length, 2)

  // Simulate partially answering the new interview before cancelling.
  useOnboardingStore.getState().setAnswer(firstQuestion, 'Sports')
  useOnboardingStore.getState().nextQuestion()
  assert.equal(useOnboardingStore.getState().currentQuestionIndex, 1)

  useOnboardingStore.getState().cancelRedo()
  const restored = useOnboardingStore.getState()
  assert.equal(restored.isComplete, true)
  assert.equal(restored.redoBackup, null)
  assert.equal(restored.currentQuestionIndex, 0)
  assert.equal(restored.answers.length, 2)
  assert.equal(restored.answers[0]?.answer, 'AI news')
})

test('completeOnboarding clears redoBackup and keeps new answers', () => {
  const store = useOnboardingStore.getState()
  store.setAnswer(firstQuestion, 'Old answer')
  store.completeOnboarding()

  useOnboardingStore.getState().startRedo()
  useOnboardingStore.getState().setAnswer(firstQuestion, 'New answer')
  useOnboardingStore.getState().completeOnboarding()

  const finalState = useOnboardingStore.getState()
  assert.equal(finalState.isComplete, true)
  assert.equal(finalState.redoBackup, null)
  assert.equal(finalState.answers.length, 1)
  assert.equal(finalState.answers[0]?.answer, 'New answer')
})

