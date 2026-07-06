import { useState } from 'react';
import AppFooter from '../components/common/AppFooter';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import Logo from '../components/common/Logo';
import api from '../lib/api';
import { useT, translate as tr } from '../i18n';

const resetPasswordSchema = yup.object({
  newPassword: yup.string().min(6, () => tr('auth.rpPwMin6')).required(() => tr('auth.rpNewPwRequired')),
  confirmPassword: yup.string()
    .oneOf([yup.ref('newPassword')], () => tr('auth.rpPwMustMatch'))
    .required(() => tr('auth.rpConfirmRequired')),
});

type ResetPasswordFormData = yup.InferType<typeof resetPasswordSchema>;

export default function ResetPassword() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: yupResolver(resetPasswordSchema),
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) {
      setError(t('auth.rpInvalidToken'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await api.post('/auth/reset-password', {
        token,
        newPassword: data.newPassword,
      });
      setIsSuccess(true);
    } catch (error: any) {
      console.error('Password reset failed:', error);
      setError(error.response?.data?.message || t('auth.rpResetError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="mb-4">
                <Logo size="large" className="justify-center" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('auth.rpInvalidTitle')}</h1>
              <p className="text-slate-600">
                {t('auth.rpInvalidText')}
              </p>
            </div>

            <Link
              to="/forgot-password"
              className="w-full btn-primary py-3 text-center block"
            >
              {t('auth.rpRequestNew')}
            </Link>

            <div className="mt-4 text-center">
              <Link
                to="/login"
                className="text-sm text-primary-600 hover:text-primary-500 inline-flex items-center"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-1" />
                {t('auth.backToLogin')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="mb-4">
                <Logo size="large" className="justify-center" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('auth.rpSuccessTitle')}</h1>
              <p className="text-slate-600">
                {t('auth.rpSuccessText')}
              </p>
            </div>

            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-primary-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-primary-800">{t('auth.rpPwUpdated')}</h4>
                  <p className="text-sm text-primary-700 mt-1">
                    {t('auth.rpPwUpdatedText')}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate('/login')}
              className="w-full btn-primary py-3"
            >
              {t('auth.rpLoginNow')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-6">
            <div className="mb-4">
              <Logo size="large" className="justify-center" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('auth.rpTitle')}</h1>
            <p className="text-slate-600">
              {t('auth.rpIntro')}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex">
                <svg className="w-5 h-5 text-red-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 mb-1">
                {t('auth.rpNewPwLabel')}
              </label>
              <div className="relative">
                <input
                  {...register('newPassword')}
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder={t('auth.rpNewPwPh')}
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
              {errors.newPassword && (
                <p className="mt-1 text-sm text-red-600">{errors.newPassword.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-1">
                {t('auth.rpConfirmLabel')}
              </label>
              <div className="relative">
                <input
                  {...register('confirmPassword')}
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder={t('auth.rpConfirmPh')}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showConfirmPassword ? (
                    <EyeSlashIcon className="h-5 w-5 text-slate-500" />
                  ) : (
                    <EyeIcon className="h-5 w-5 text-slate-500" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary py-3"
            >
              {isLoading ? t('auth.rpUpdating') : t('auth.rpSubmit')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-primary-600 hover:text-primary-500 inline-flex items-center"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-1" />
              Zurück zur Anmeldung
            </Link>
          </div>

          <div className="mt-6 text-center">
            <AppFooter />
          </div>
        </div>
      </div>
    </div>
  );
}