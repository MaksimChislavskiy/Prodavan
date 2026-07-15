import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CrmAppPage } from './pages/CrmAppPage'

const rootPage = window.location.pathname === '/profile'
  ? <CrmAppPage />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {rootPage}
  </StrictMode>,
)
