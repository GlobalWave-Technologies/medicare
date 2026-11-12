import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { initTheme } from './app/theme'
import { reportRenderFailure } from './components/ui/reportRenderFailure'
import { initInstall } from './pwa/install'
import { initConnectivity } from './pwa/connectivity'
import { registerServiceWorker } from './pwa/updates'

initTheme()
// Captured before the first render: browsers may offer installation as soon as the page loads.
initInstall()
initConnectivity()
// Production builds only; the service worker caches static application files, never hospital data.
if (import.meta.env.PROD) void registerServiceWorker()

createRoot(document.getElementById('root')!, { onCaughtError: reportRenderFailure }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
