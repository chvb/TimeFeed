import { useState } from 'react';
import AppFooter from '../components/common/AppFooter';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Logo from '../components/common/Logo';
import api from '../lib/api';
import { useT, translate as tr } from '../i18n';

const forgotPasswordSchema = yup.object({
  email: yup.string().email(() => tr('auth.emailInvalid')).required(() => tr('auth.emailRequired')),
});

type ForgotPasswordFormData = yup.InferType<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const t = useT();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: yupResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    try {
      await api.post('/auth/forgot-password', data);
      setIsSubmitted(true);
    } catch (error) {
      console.error('Forgot password request failed:', error);
      // Still show success to prevent user enumeration
      setIsSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-6">
              <div className="mb-4">
                <Logo size="large" className="justify-center" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('auth.fpEmailSentTitle')}</h1>
              <p className="text-slate-600">
                {t('auth.fpEmailSentText')}
              </p>
            </div>

            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-primary-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-primary-800">{t('auth.fpCheckInbox')}</h4>
                  <p className="text-sm text-primary-700 mt-1">
                    {t('auth.fpLinkValid1h')}
                  </p>
                </div>
              </div>
            </div>

            <Link
              to="/login"
              className="w-full btn-secondary py-3 flex items-center justify-center"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              {t('auth.backToLogin')}
            </Link>
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
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('auth.fpTitle')}</h1>
            <p className="text-slate-600">
              {t('auth.fpIntro')}
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                {t('auth.fpEmailLabel')}
              </label>
              <input
                {...register('email')}
                type="email"
                className="input-field"
                placeholder="name@firma.de"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary py-3"
            >
              {isLoading ? t('auth.fpSending') : t('auth.fpSendLink')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-primary-600 hover:text-primary-500 inline-flex items-center"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-1" />
              {t('auth.backToLogin')}
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