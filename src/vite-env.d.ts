/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_DEBUG: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Type declarations for packages without @types
declare module 'react-katex' {
  import type { ComponentType } from 'react'
  import type React from 'react'

  type KatexProps = { math: string } & Omit<React.HTMLAttributes<HTMLElement>, 'children'>

  export const InlineMath: ComponentType<KatexProps>
  export const BlockMath: ComponentType<KatexProps>
}
