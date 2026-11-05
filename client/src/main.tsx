import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { initTheme } from './app/theme'
import { reportRenderFailure } from './components/ui/reportRenderFailure'

initTheme()

createRoot(document.getElementById('root')!, { onCaughtError: reportRenderFailure }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
