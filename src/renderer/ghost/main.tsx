import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/globals.css'
import '../styles/ghost.css'
import { Ghost } from './Ghost'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Ghost />
  </StrictMode>
)
