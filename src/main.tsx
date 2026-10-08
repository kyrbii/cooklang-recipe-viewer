import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Clear any stale ServiceWorker API caches from earlier builds
if (typeof window !== 'undefined' && 'caches' in window) {
  caches.delete('cook-api-cache').catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
