import { useState } from 'react';
import AppFooter from '../components/common/AppFooter';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useAuthStore } from '../store/authStore';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import Logo from '../components/common/Logo';
import { useT } from '../i18n';

const loginSchema = yup.object({
  email: yup.string().email('Ungültige E-Mail-Adresse').required('E-Mail ist erforderlich'),
  password: yup.string().min(6, 'Passwort muss mindestens 6 Zeichen lang sein').required('Passwort ist erforderlich'),
});

type LoginFormData = yup.InferType<typeof loginSchema>;

export default function Login() {
  const t = useT();
  const navigate = useNavigate();
  const { login, isLoading } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: yupResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      await login(data.email, data.password);
      navigate('/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-4">
            <div className="mb-4">
              <Logo size="large" className="justify-center" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">TimeFeed</h1>
            <p className="text-slate-600">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                {t('login.email')}
              </label>
              <input
                {...register('email')}
                type="email"
                className="input-field"
                placeholder={t('login.emailPlaceholder')}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                {t('login.password')}
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5 text-slate-500" />
                  ) : (
                    <EyeIcon className="h-5 w-5 text-slate-500" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700">
                  {t('login.remember')}
                </label>
              </div>

              <Link to="/forgot-password" className="text-sm text-primary-600 hover:text-primary-500">
                {t('login.forgot')}
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary py-3"
            >
              {isLoading ? t('login.submitting') : t('login.submit')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <AppFooter />
          </div>
        </div>
      </div>
    </div>
  );
}