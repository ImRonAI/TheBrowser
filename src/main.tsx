import React from 'react'
import ReactDOM from 'react-dom/client'
// Ren type system (docs/brand.md): Inter (UI) + Bricolage Grotesque (display: opsz, wdth, wght), both variable,
// JetBrains Mono for code and tag labels.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { App } from './App'
import { OpeningSequenceGate } from './components/brand/OpeningSequence'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <OpeningSequenceGate />
  </React.StrictMode>,
)