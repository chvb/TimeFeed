import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n';
import './index.css';

// Dark-Mode-Präferenz früh anwenden (vor dem Render), um Flackern zu vermeiden.
// Öffentliche NFC-Seiten (/nfc) IMMER im hellen Marken-Look (weiße Karte auf Orange),
// nie dunkelblau – daher dort den Dark-Mode nicht anwenden.
const isPublicNfc = /^\/nfc(\/|$)/.test(window.location.pathname);
if (localStorage.getItem('tf-theme') === 'dark' && !isPublicNfc) {
  document.documentElement.classList.add('dark');
}
document.documentElement.lang = localStorage.getItem('tf-lang') === 'en' ? 'en' : 'de';

// PWA: Service Worker registrieren (Offline-Basis + Installierbarkeit).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Animierten Splash-Screen ausblenden, sobald die App gemountet ist.
const splash = document.getElementById('tf-splash');
if (splash) {
  window.setTimeout(() => {
    splash.classList.add('tf-splash-hide');
    window.setTimeout(() => splash.remove(), 400);
  }, 300);
}