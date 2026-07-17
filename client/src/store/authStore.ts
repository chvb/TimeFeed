import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { setCompanyBranding } from '../components/common/brand';
import { translate as tr } from '../i18n';

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'buchhaltung' | 'verwaltung' | 'mitarbeiter';
  isSuperAdmin?: boolean;
  companyId?: number | null;
  tenantId?: number | null;
  company?: { id: number; name: string; logo?: string | null } | null;
  groupId?: number;
  phoneNumber?: string;
  department?: string;
  position?: string;
}

/** Mandanten-Admin: Rolle admin/buchhaltung mit Mandant, aber ohne feste Firma → verwaltet alle Firmen seines Tenants. */
export const isTenantAdmin = (u?: User | null): boolean =>
  !!u && (u.role === 'admin' || u.role === 'buchhaltung') && !!u.tenantId && !u.companyId;

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  fetchCurrentUser: () => Promise<void>;
  updateUser: (userData: Partial<User>) => void;
  setToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await api.post('/auth/login', { email, password });
          const { token, user } = response.data;
          
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
          
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          toast.success(tr('toast.loginSuccess'));
        } catch (error: any) {
          set({ isLoading: false });
          const msg = error.response?.status === 401
            ? tr('toast.loginWrong')
            : (error.response?.data?.error || tr('toast.loginFailed'));
          toast.error(msg);
          throw error;
        }
      },

      register: async (data: any) => {
        set({ isLoading: true });
        try {
          const response = await api.post('/auth/register', data);
          const { token, user } = response.data;
          
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
          
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          toast.success(tr('toast.registerSuccess'));
        } catch (error: any) {
          set({ isLoading: false });
          toast.error(error.response?.data?.error || tr('toast.registerFailed'));
          throw error;
        }
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
        delete api.defaults.headers.common['Authorization'];
        // Persistiertes Token explizit entfernen (api.ts liest direkt aus
        // localStorage) — verhindert, dass es nach Logout noch lesbar ist.
        try { localStorage.removeItem('auth-storage'); } catch { /* ignore */ }
        try { localStorage.removeItem('tf-company-context'); } catch { /* ignore */ } // Firmen-/Mandanten-Filter nicht über Logout hinweg behalten
        setCompanyBranding({});
        toast.success(tr('toast.logoutSuccess'));
      },

      fetchCurrentUser: async () => {
        const token = get().token;
        if (!token) return;
        
        try {
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          const response = await api.get('/auth/me');
          set({ user: response.data.user });
          // Firmen-Branding (Logo/Name) für Druck-/PDF-Ausgaben übernehmen.
          setCompanyBranding(response.data.user?.company || {});
        } catch (error: any) {
          // Nur bei echtem 401 (Token ungültig/entwertet) abmelden. Netzwerk-/Server-
          // Aussetzer (kein response, 5xx) dürfen eine gültige Sitzung NICHT verwerfen.
          if (error?.response?.status === 401) {
            set({ user: null, token: null, isAuthenticated: false });
            delete api.defaults.headers.common['Authorization'];
          }
        }
      },

      updateUser: (userData: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        }));
      },

      // Frisches Token nach Passwortänderung übernehmen (Gerät bleibt eingeloggt).
      setToken: (token: string) => {
        set({ token });
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);