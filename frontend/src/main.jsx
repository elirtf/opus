import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import('virtual:pwa-register')
  .then(({ registerSW }) => registerSW({ immediate: true }))
  .catch((e) => {
    // #region agent log
    fetch('http://127.0.0.1:7548/ingest/08386897-29be-4b7e-bdb0-4c0c1d047610',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'db7884'},body:JSON.stringify({sessionId:'db7884',hypothesisId:'H5',location:'main.jsx:pwa-register',message:'PWA register import failed',data:{errName:e?.name||'unknown'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)