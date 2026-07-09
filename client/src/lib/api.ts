import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      const { state } = JSON.parse(authStorage);
      if (state.token) {
        config.headers.Authorization = `Bearer ${state.token}`;
      }
    }
    // Firmen-Kontext (Wechsler): bei GET-Anfragen die gewählte Firma als companyId anhängen,
    // damit firmenübergreifende Nutzer (Super-Admin/zentrale HR) Ansichten je Firma filtern.
    // '' = „Alle Firmen" → kein Parameter.
    const cc = localStorage.getItem('tf-company-context');
    if (cc && (config.method || 'get').toLowerCase() === 'get') {
      // Wert ist 'company:<id>' oder 'tenant:<id>' (leer = alle → kein Parameter).
      // Explizit von der Seite gesetzte Parameter haben Vorrang (z. B. Firmen-Auswahl
      // auf der Lohn-Export-Seite) — Kontext nur ergänzen, nicht überschreiben.
      // WICHTIG: auch Query-Strings in config.url berücksichtigen, sonst entsteht bei
      // Seiten, die companyId/tenantId direkt an die URL hängen, ein DOPPELTER Parameter
      // (Express liest dann ein Array → NaN → falsche/globale Auflösung).
      const p = (config.params || {}) as Record<string, unknown>;
      const urlHas = (key: string) =>
        typeof config.url === 'string' && new RegExp(`[?&]${key}=`).test(config.url);
      if (cc.startsWith('tenant:') && p.tenantId == null && !urlHas('tenantId')) config.params = { ...p, tenantId: cc.slice(7) };
      else if (cc.startsWith('company:') && p.companyId == null && !urlHas('companyId')) config.params = { ...p, companyId: cc.slice(8) };
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 auf Auth-Endpunkten (z. B. falsches Passwort beim Login) NICHT als Session-Ablauf
    // behandeln – sonst Redirect/Reload, der die Fehlermeldung verschluckt.
    const url: string = error.config?.url || '';
    const isAuthEndpoint = /\/auth\/(login|forgot-password|reset-password|register)/.test(url);
    if (error.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;