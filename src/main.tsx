import React from 'react'
import ReactDOM from 'react-dom/client'
// Ron 2026 type system: Inter (UI) + Newsreader (editorial display), both variable.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import { App } from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)