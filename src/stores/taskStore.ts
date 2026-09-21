import { create } from 'zustand'
import { Task, TaskStatus, TaskRelationship, RelationshipType } from '@/pages/types/task'

// Sample data adapted from TaskCard.tsx
const sampleTasks: Task[] = [
  {
    id: '1',
    title: 'Design new onboarding flow with voice interaction',
    description: 'Create a seamless onboarding experience that introduces the voice agent capabilities.',
    status: 'in-progress',
    priority: 'high',
    type: 'feature',
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now(),
    dueDate: Date.now() + 2 * 24 * 60 * 60 * 1000,
    hasNotification: true,
    assignees: [
      { id: 'c1', name: 'Alex Chen', initials: 'AC' },
      { id: 'c2', name: 'Sarah Kim', initials: 'SK' },
      { id: 'c3', name: 'Mike Ross', initials: 'MR' },
    ],
    labels: [{ id: 'i1', label: 'Design', color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400' }],
    subtasks: Array.from({ length: 8 }, (_, i) => ({
      id: `st-1-${i}`,
      title: `Subtask ${i + 1}`,
      completed: i < 5,
      order: i
    })),
    progress: 62,
    healthIndicator: 'on-track',
    // This task is parent of its subtasks
    relationships: [
      { id: 'rel-1-1', type: 'parent' as const, targetTaskId: 'st-1-0', targetTaskTitle: 'Subtask 1', createdAt: Date.now() },
      { id: 'rel-1-2', type: 'parent' as const, targetTaskId: 'st-1-1', targetTaskTitle: 'Subtask 2', createdAt: Date.now() },
      { id: 'rel-1-3', type: 'parent' as const, targetTaskId: 'st-1-2', targetTaskTitle: 'Subtask 3', createdAt: Date.now() },
      { id: 'rel-1-4', type: 'parent' as const, targetTaskId: 'st-1-3', targetTaskTitle: 'Subtask 4', createdAt: Date.now() },
      { id: 'rel-1-5', type: 'parent' as const, targetTaskId: 'st-1-4', targetTaskTitle: 'Subtask 5', createdAt: Date.now() },
      { id: 'rel-1-6', type: 'parent' as const, targetTaskId: 'st-1-5', targetTaskTitle: 'Subtask 6', createdAt: Date.now() },
      { id: 'rel-1-7', type: 'parent' as const, targetTaskId: 'st-1-6', targetTaskTitle: 'Subtask 7', createdAt: Date.now() },
      { id: 'rel-1-8', type: 'parent' as const, targetTaskId: 'st-1-7', targetTaskTitle: 'Subtask 8', createdAt: Date.now() },
    ]
  },
  {
    id: '2',
    title: 'Implement agent memory persistence',
    description: 'Ensure context is saved across sessions using vector db.',
    status: 'in-progress',
    priority: 'high',
    type: 'feature',
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now(),
    dueDate: Date.now() + 24 * 60 * 60 * 1000,
    hasNotification: false,
    assignees: [
      { id: 'c1', name: 'Alex Chen', initials: 'AC' },
    ],
    labels: [{ id: 'i2', label: 'Engineering', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' }],
    subtasks: Array.from({ length: 4 }, (_, i) => ({
      id: `st-2-${i}`,
      title: `Subtask ${i + 1}`,
      completed: i < 1,
      order: i
    })),
    progress: 25,
    healthIndicator: 'at-risk',
    relationships: [
      { id: 'rel-2-1', type: 'parent' as const, targetTaskId: 'st-2-0', targetTaskTitle: 'Subtask 1', createdAt: Date.now() },
      { id: 'rel-2-2', type: 'parent' as const, targetTaskId: 'st-2-1', targetTaskTitle: 'Subtask 2', createdAt: Date.now() },
      { id: 'rel-2-3', type: 'parent' as const, targetTaskId: 'st-2-2', targetTaskTitle: 'Subtask 3', createdAt: Date.now() },
      { id: 'rel-2-4', type: 'parent' as const, targetTaskId: 'st-2-3', targetTaskTitle: 'Subtask 4', createdAt: Date.now() },
    ]
  },
  {
    id: '3',
    title: 'Research competitor AI browsers',
    description: 'Analyze Arc, Sigma, and others.',
    status: 'review',
    priority: 'medium',
    type: 'research',
    createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now(),
    dueDate: Date.now() - 24 * 60 * 60 * 1000,
    hasNotification: true,
    assignees: [
      { id: 'c2', name: 'Sarah Kim', initials: 'SK' },
      { id: 'c4', name: 'Emma Liu', initials: 'EL' },
      { id: 'c5', name: 'John Doe', initials: 'JD' },
    ],
    labels: [{ id: 'i3', label: 'Research', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' }],
    subtasks: Array.from({ length: 3 }, (_, i) => ({
      id: `st-3-${i}`,
      title: `Subtask ${i + 1}`,
      completed: i < 3,
      order: i
    })),
    progress: 100,
    healthIndicator: 'on-track',
    relationships: [
      { id: 'rel-3-1', type: 'parent' as const, targetTaskId: 'st-3-0', targetTaskTitle: 'Subtask 1', createdAt: Date.now() },
      { id: 'rel-3-2', type: 'parent' as const, targetTaskId: 'st-3-1', targetTaskTitle: 'Subtask 2', createdAt: Date.now() },
      { id: 'rel-3-3', type: 'parent' as const, targetTaskId: 'st-3-2', targetTaskTitle: 'Subtask 3', createdAt: Date.now() },
    ]
  },
  {
    id: '4',
    title: 'Write privacy policy documentation',
    description: 'Standard GDPR compliance docs.',
    status: 'backlog',
    priority: 'low',
    type: 'documentation',
    createdAt: Date.now() - 12 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now(),
    dueDate: null,
    hasNotification: false,
    assignees: [],
    labels: [{ id: 'i4', label: 'Legal', color: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400' }],
    subtasks: [],
    progress: 0,
    healthIndicator: 'on-track',
    relationships: []
  },
  // Sample Subtasks (to match Task 1)
  {
    id: 'st-1-0',
    title: 'Subtask 1',
    description: 'Detailed work for subtask 1',
    status: 'backlog',
    priority: 'medium',
    type: 'feature',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueDate: null,
    hasNotification: false,
    assignees: [],
    labels: [],
    subtasks: [],
    parentTaskId: '1',
    relationships: [{ id: 'rel-c-1', type: 'child', targetTaskId: '1', targetTaskTitle: 'Design new onboarding flow with voice interaction', createdAt: Date.now() }]
  },
  {
    id: 'st-1-1',
    title: 'Subtask 2',
    description: 'Detailed work for subtask 2',
    status: 'backlog',
    priority: 'medium',
    type: 'feature',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueDate: null,
    hasNotification: false,
    assignees: [],
    labels: [],
    subtasks: [],
    parentTaskId: '1',
    relationships: [{ id: 'rel-c-2', type: 'child', targetTaskId: '1', targetTaskTitle: 'Design new onboarding flow with voice interaction', createdAt: Date.now() }]
  },
  {
    id: 'st-1-2',
    title: 'Subtask 3',
    description: 'Detailed work for subtask 3',
    status: 'in-progress',
    priority: 'high',
    type: 'feature',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueDate: null,
    hasNotification: false,
    assignees: [],
    labels: [],
    subtasks: [],
    parentTaskId: '1',
    relationships: [{ id: 'rel-c-3', type: 'child', targetTaskId: '1', targetTaskTitle: 'Design new onboarding flow with voice interaction', createdAt: Date.now() }]
  }
]

interface TaskState {
  tasks: Task[]
  
  // Actions
  createTask: (task: Partial<Task>) => Task
  createSubtask: (parentTaskId: string, subtaskData: Partial<Task>) => Task
  updateTask: (taskId: string, updates: Partial<Task>) => void
  deleteTask: (taskId: string) => void
  moveTask: (taskId: string, newStatus: TaskStatus) => void
  
  // Relationships
  addRelationship: (taskId: string, targetTaskId: string, type: RelationshipType) => void
  removeRelationship: (taskId: string, relationshipId: string) => void
  
  // File References (Agent)
  addFileReference: (taskId: string, fileRef: any) => void
}

export const useTaskStore = create<TaskState>()((set, get) => ({
  tasks: sampleTasks,

  createTask: (taskOverrides: any) => {
    const state = get()
    // Use the comprehensive normalizer
    const normalizedData = normalizeTaskInput(taskOverrides, state.tasks)

    // CHECK FOR DUPLICATES / UPSERT
    // If the agent provides an ID that already exists, treat this as an UPDATE
    // This is a safety net for when the agent tries to "re-create" a task to update it
    if (normalizedData.id) {
        const existingTask = state.tasks.find(t => t.id === normalizedData.id)
        if (existingTask) {
            // Upsert: Update existing task
            const { id, ...updates } = normalizedData
            state.updateTask(id, updates)
            return state.tasks.find(t => t.id === id)!
        }
    }

    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: 'New Task',
      status: 'backlog',
      priority: 'medium',
      type: 'feature',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hasNotification: false,
      relationships: [],
      conversations: [], 
      assignees: [],
      labels: [],
      subtasks: [],
      // Overrides come last but assignees/labels/subtasks are already handled in normalizedData
      ...normalizedData
    }
    
    set((state) => ({
      tasks: [newTask, ...state.tasks]
    }))
    
    return newTask
  },

  // Create a subtask that is automatically a child of the parent
  createSubtask: (parentTaskId, subtaskData) => {
    const state = get()
    const parentTask = state.tasks.find(t => t.id === parentTaskId)
    
    // Normalize the subtask data too
    const normalizedData = normalizeTaskInput(subtaskData, state.tasks)
    
    const newSubtask: Task = {
      id: `task-${Date.now()}`,
      title: normalizedData.title || 'New Subtask',
      status: 'backlog',
      priority: normalizedData.priority || 'medium',
      type: normalizedData.type || 'feature',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hasNotification: false,
      assignees: normalizedData.assignees || [],
      labels: normalizedData.labels || [],
      subtasks: normalizedData.subtasks || [],
      parentTaskId: parentTaskId, // Set parent reference
      relationships: [
        // Automatically add "child" relationship to parent
        {
          id: `rel-${Date.now()}`,
          type: 'child' as const,
          targetTaskId: parentTaskId,
          targetTaskTitle: parentTask?.title || 'Parent Task',
          createdAt: Date.now()
        }
      ],
      // Apply other normalized fields (dates, etc)
      ...normalizedData
    }
    
    // Also add reciprocal "parent" relationship to parent task
    const parentRelationship: TaskRelationship = {
      id: `rel-${Date.now() + 1}`,
      type: 'parent',
      targetTaskId: newSubtask.id,
      targetTaskTitle: newSubtask.title,
      createdAt: Date.now()
    }
    
    set((state) => ({
      tasks: [
        newSubtask,
        ...state.tasks.map(t => 
          t.id === parentTaskId 
            ? { ...t, relationships: [...(t.relationships || []), parentRelationship], updatedAt: Date.now() }
            : t
        )
      ]
    }))
    
    return newSubtask
  },

  updateTask: (taskId, updates) => {
    // Normalize updates (handle assigneeIds, string dates etc)
    const state = get()
    // Normalizer handles mapping without needing current task state
    
    const normalizedUpdates = normalizeTaskInput(updates, state.tasks)
    
    set((state) => ({
      tasks: state.tasks.map((t) => 
        t.id === taskId ? { ...t, ...normalizedUpdates, updatedAt: Date.now() } : t
      )
    }))
  },

  deleteTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId)
    }))
  },

  moveTask: (taskId, newStatus) => {
    set((state) => ({
      tasks: state.tasks.map((t) => 
        t.id === taskId ? { ...t, status: newStatus, updatedAt: Date.now() } : t
      )
    }))
  },
  
  // Add relationship - supports multiple relationships
  addRelationship: (taskId, targetTaskId, type) => {
    const state = get()
    const sourceTask = state.tasks.find(t => t.id === taskId)
    const targetTask = state.tasks.find(t => t.id === targetTaskId)
    
    if (!sourceTask || !targetTask) return

    // 1. Add Forward Relationship (A -> B)
    const newRelationship: TaskRelationship = {
      id: `rel-${Date.now()}`,
      type,
      targetTaskId,
      targetTaskTitle: targetTask.title,
      targetTaskStatus: targetTask.status,
      createdAt: Date.now()
    }

    // 2. Determine Inverse Type
    let inverseType: RelationshipType | undefined
    switch (type) {
      case 'blocks': inverseType = 'blocked-by'; break;
      case 'blocked-by': inverseType = 'blocks'; break;
      case 'parent': inverseType = 'child'; break;
      case 'child': inverseType = 'parent'; break;
      case 'causes': inverseType = 'caused-by'; break;
      case 'caused-by': inverseType = 'causes'; break;
      case 'implements': inverseType = 'implemented-by'; break;
      case 'implemented-by': inverseType = 'implements'; break;
      case 'relates-to': inverseType = 'relates-to'; break;
    }

    // 3. Add Inverse Relationship (B -> A) if type is known
    let inverseRelationship: TaskRelationship | undefined
    if (inverseType) {
      inverseRelationship = {
        id: `rel-${Date.now()}-inv`,
        type: inverseType,
        targetTaskId: taskId,
        targetTaskTitle: sourceTask.title,
        targetTaskStatus: sourceTask.status,
        createdAt: Date.now()
      }
    }
    
    set((state) => ({
      tasks: state.tasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            relationships: [...(t.relationships || []), newRelationship],
            updatedAt: Date.now()
          }
        }
        if (inverseRelationship && t.id === targetTaskId) {
           return {
            ...t,
            relationships: [...(t.relationships || []), inverseRelationship],
            updatedAt: Date.now()
          }
        }
        return t
      })
    }))
  },
  
  // Remove a specific relationship
  removeRelationship: (taskId, relationshipId) => {
    set((state) => ({
      tasks: state.tasks.map(t => {
        if (t.id !== taskId) return t
        return {
          ...t,
          relationships: (t.relationships || []).filter(r => r.id !== relationshipId),
          updatedAt: Date.now()
        }
      })
    }))
  },
  
  addFileReference: (taskId, fileRef) => {
    set((state) => ({
      tasks: state.tasks.map(t => {
        if (t.id !== taskId) return t
        return {
          ...t,
          fileReferences: [...(t.fileReferences || []), fileRef]
        }
      })
    }))
  }
}))

// ─────────────────────────────────────────────
// HELPER: Input Normalizer (Agent/API -> Store)
// ─────────────────────────────────────────────
const normalizeTaskInput = (input: any, _existingTasks: Task[] = []): Partial<Task> => {
  if (!input) return {}
  const output: any = { ...input }

  // 1. Assignees (Map IDs -> Objects)
  // Support both 'assigneeIds' (from agent) and direct 'assignees'
  if (input.assigneeIds && Array.isArray(input.assigneeIds)) {
    const mappedAssignees = input.assigneeIds
      .map((id: string) => {
        if (id.toLowerCase() === 'user' || id.toLowerCase() === 'u') {
          return { id: 'user', name: 'User', initials: 'ME', role: 'Owner' }
        }
        if (id.toLowerCase() === 'agent' || id.toLowerCase() === 'ron' || id.toLowerCase() === 'ai') {
          return { id: 'agent', name: 'Ron', initials: 'AI', role: 'Assistant' }
        }
        // Try to find existing assignee in other tasks? For now just skip unknown IDs 
        // or create a placeholder if it looks like a name
        if (id.length > 2) {
           // Basic heuristic for unknown IDs that might be names
           return { 
             id: id, 
             name: id, 
             initials: id.substring(0, 2).toUpperCase() 
           }
        }
        return null
      })
      .filter(Boolean)
    
    // Merge with existing if specified, or replace? 
    // Agent usually sends full list, so replace is safer.
    // If input also had 'assignees', we defer to 'assigneeIds' as the source of truth if both exist
    output.assignees = mappedAssignees
    delete output.assigneeIds
  }

  // 2. Labels (Map Strings -> Objects)
  if (input.labels && Array.isArray(input.labels) && input.labels.length > 0) {
    // If already objects, leave them. If strings, map them.
    if (typeof input.labels[0] === 'string') {
      const colors = [
        'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400',
        'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400', 
        'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
        'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
        'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400',
      ]
      output.labels = input.labels.map((lbl: string, code: number) => ({
        id: `lbl-${lbl.toLowerCase().replace(/\s+/g, '-')}`,
        label: lbl,
        color: colors[code % colors.length]
      }))
    }
  }

  // 3. Dates (String -> Number)
  const dateFields = ['dueDate', 'startDate', 'slaDeadline']
  dateFields.forEach(field => {
    if (input[field]) {
      if (typeof input[field] === 'string') {
        const parsed = Date.parse(input[field])
        if (!isNaN(parsed)) {
          output[field] = parsed
        } else {
           // remove invalid date string
           delete output[field]
        }
      } 
      // already number? leave it.
    }
  })
  
  // 4. Snake_case to camelCase conversion (common agent issue)
  if (input.due_date && !output.dueDate) {
     const parsed = Date.parse(input.due_date)
     if (!isNaN(parsed)) output.dueDate = parsed
  }
  
  // 5. Subtasks (Ensure correct shape)
  if (input.subtasks && Array.isArray(input.subtasks)) {
    output.subtasks = input.subtasks.map((st: any, idx: number) => ({
      ...st,
      id: st.id || `st-${Date.now()}-${idx}`,
      completed: !!st.completed,
      title: st.title || 'Untitled Subtask',
      order: st.order ?? idx
    }))
  }

  return output
}

// Expose store to window for Agent access
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.ronApp = window.ronApp || {}
  // @ts-ignore
  window.ronApp.taskStore = {
    getState: () => useTaskStore.getState(),
    createTask: (task: any) => useTaskStore.getState().createTask(task),
    createSubtask: (parentId: string, task: any) => useTaskStore.getState().createSubtask(parentId, task),
    updateTask: (id: string, updates: any) => useTaskStore.getState().updateTask(id, updates),
    addRelationship: (taskId: string, targetId: string, type: any) => useTaskStore.getState().addRelationship(taskId, targetId, type),
    removeRelationship: (taskId: string, relId: string) => useTaskStore.getState().removeRelationship(taskId, relId),
    addFileReference: (id: string, ref: any) => useTaskStore.getState().addFileReference(id, ref),
    getTasks: () => useTaskStore.getState().tasks
  }
}

