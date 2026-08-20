import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Новый слой представления (редизайн). Токены и флаги поднимаем до рендера,
// чтобы первый кадр уже был в правильной теме.
import './pg/tokens.css'
import { initFlags } from './pg/flags'
import { initPgTheme } from './pg/theme'
import { ToastHost } from './pg/notify'
import { checkForUpdate } from './pg/updateCheck'

initFlags()
initPgTheme()
// Telegram кэширует Mini App: если на сервере уже новая сборка, перезагрузимся
checkForUpdate()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    {/* Тосты поверх любого экрана — заменяют блокирующий alert() */}
    <ToastHost />
  </React.StrictMode>,
)
