import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './PasswordResetModal.mobile.css'
import { AccountDeletedNotice } from './components/AccountDeletedNotice'
import { CrmAppPage } from './pages/CrmAppPage'
import { installAiMaterialsController } from './shared/aiMaterialsController'

installAiMaterialsController()

const rootPage = window.location.pathname === '/profile'
  ? <CrmAppPage />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      {rootPage}
      <AccountDeletedNotice />
    </>
  </StrictMode>,
)
