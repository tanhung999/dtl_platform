import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './themes.css'
import { installVietnameseValidation } from './services/formValidation'

const removeValidation = installVietnameseValidation()
if (import.meta.hot) import.meta.hot.dispose(removeValidation)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </React.StrictMode>,
)
