import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { UserIcon, EnvelopeIcon, PhoneIcon, BuildingOfficeIcon, BriefcaseIcon, CalendarDaysIcon, LockClosedIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useConfirm } from '../components/common/ConfirmProvider';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useT } from '../i18n';

export default function Profile() {
  const t = useT();
  const { user, updateUser } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordRequirements, setPasswordRequirements] = useState<any>(null);
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phoneNumber: user?.phoneNumber || '',
    department: user?.department || '',
    position: user?.position || '',
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [icalUrl, setIcalUrl] = useState('');
  const { confirm } = useConfirm();

  useEffect(() => {
    fetchPasswordRequirements();
    api.get('/users/me/ical').then((r) => setIcalUrl(r.data.url)).catch(() => {});
  }, []);

  const fetchPasswordRequirements = async () => {
    try {
      const response = await api.get('/settings');
      setPasswordRequirements(response.data);
    } catch (error) {
      console.error('Failed to fetch password requirements:', error);
    }
  };

  const copyIcal = () => {
    if (!icalUrl) return;
    navigator.clipboard?.writeText(icalUrl).then(
      () => toast.success(t('profile.icalCopied')),
      () => toast.error(t('profile.copyFailed')),
    );
  };

  const regenerateIcal = async () => {
    if (!(await confirm({ title: t('profile.regenConfirmTitle'), message: t('profile.regenConfirmMsg'), confirmText: t('profile.regenConfirmBtn') }))) return;
    try {
      const r = await api.post('/users/me/ical/regenerate');
      setIcalUrl(r.data.url);
      toast.success(t('profile.regenSuccess'));
    } catch {
      toast.error(t('profile.regenError'));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    try {
      const response = await api.put(`/users/${user.id}`, formData);
      updateUser(response.data.user);
      setIsEditing(false);
      toast.success(t('profile.updateSuccess'));
    } catch (error: any) {
      console.error('Failed to update profile:', error);
      toast.error(error.response?.data?.message || t('profile.updateError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validierungen
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error(t('profile.passwordsMismatchToast'));
      return;
    }

    // Prüfe Passwortanforderungen
    const pwd = passwordData.newPassword;
    if (passwordRequirements) {
      if (pwd.length < passwordRequirements.passwordMinLength) {
        toast.error(t('profile.pwMinLength', { count: passwordRequirements.passwordMinLength }));
        return;
      }
      if (passwordRequirements.passwordRequireUppercase && !/[A-Z]/.test(pwd)) {
        toast.error(t('profile.pwUppercase'));
        return;
      }
      if (passwordRequirements.passwordRequireLowercase && !/[a-z]/.test(pwd)) {
        toast.error(t('profile.pwLowercase'));
        return;
      }
      if (passwordRequirements.passwordRequireNumbers && !/\d/.test(pwd)) {
        toast.error(t('profile.pwNumber'));
        return;
      }
      if (passwordRequirements.passwordRequireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) {
        toast.error(t('profile.pwSpecial'));
        return;
      }
    }
    
    setIsSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });
      
      toast.success(t('profile.passwordChanged'));
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setIsChangingPassword(false);
    } catch (error: any) {
      console.error('Failed to change password:', error);
      toast.error(error.response?.data?.message || t('profile.passwordChangeError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email || '',
      phoneNumber: user?.phoneNumber || '',
      department: user?.department || '',
      position: user?.position || '',
    });
    setIsEditing(false);
  };

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">{t('profile.userNotFound')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('profile.title')}</h1>
          <p className="text-slate-600 mt-2">
            {t('profile.subtitle')}
          </p>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="btn-primary"
          >
            {t('profile.edit')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Summary Card */}
        <div className="card">
          <div className="text-center">
            <div className="w-20 h-20 bg-primary-600 rounded-full flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-1">
              {user.firstName} {user.lastName}
            </h2>
            <p className="text-slate-600 mb-4">{t(`roles.${user.role}`) !== `roles.${user.role}` ? t(`roles.${user.role}`) : user.role}</p>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-center">
                <EnvelopeIcon className="h-4 w-4 mr-2" />
                {user.email}
              </div>
              {user.phoneNumber && (
                <div className="flex items-center justify-center">
                  <PhoneIcon className="h-4 w-4 mr-2" />
                  {user.phoneNumber}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Work Info Card */}
        <div className="card">
          <div className="flex items-center mb-4">
            <BriefcaseIcon className="h-6 w-6 text-primary-600 mr-3" />
            <h3 className="text-lg font-semibold text-slate-900">{t('profile.workplace')}</h3>
          </div>
          <div className="space-y-3">
            {user.department && (
              <div className="flex items-center">
                <BuildingOfficeIcon className="h-4 w-4 text-slate-400 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">{t('profile.department')}</p>
                  <p className="font-semibold text-slate-900">{user.department}</p>
                </div>
              </div>
            )}
            {user.position && (
              <div className="flex items-center">
                <UserIcon className="h-4 w-4 text-slate-400 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">{t('profile.position')}</p>
                  <p className="font-semibold text-slate-900">{user.position}</p>
                </div>
              </div>
            )}
            {!user.department && !user.position && (
              <p className="text-slate-500 italic">{t('profile.noWorkInfo')}</p>
            )}
          </div>
        </div>
      </div>


      {/* Edit Form */}
      {isEditing && (
        <div className="card mt-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-6">{t('profile.editHeading')}</h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('profile.firstName')}
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('profile.lastName')}
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('profile.email')}
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('profile.phone')}
              </label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder={t('profile.optional')}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('profile.department')}
                </label>
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder={t('profile.optional')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('profile.position')}
                </label>
                <input
                  type="text"
                  name="position"
                  value={formData.position}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder={t('profile.optional')}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-slate-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={isSubmitting}
              >
                {t('profile.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={clsx(
                  "px-4 py-2 text-white rounded-lg transition-colors",
                  isSubmitting
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-primary-600 hover:bg-primary-700"
                )}
              >
                {isSubmitting ? t('profile.saving') : t('profile.saveChanges')}
              </button>
            </div>
          </form>
          
          {/* Password Change Section - Only shown when editing */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex items-center">
                <LockClosedIcon className="h-6 w-6 text-primary-600 mr-3" />
                <h3 className="text-lg font-semibold text-slate-900">{t('profile.passwordSecurity')}</h3>
              </div>
              {!isChangingPassword && (
                <button
                  onClick={() => setIsChangingPassword(true)}
                  className="btn-secondary text-sm"
                >
                  {t('profile.changePassword')}
                </button>
              )}
            </div>

            {isChangingPassword ? (
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('profile.currentPassword')}
                  </label>
                  <input
                    type="password"
                    name="currentPassword"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('profile.newPassword')}
                  </label>
                  <input
                    type="password"
                    name="newPassword"
                    value={passwordData.newPassword}
                    onChange={handlePasswordChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                  {passwordRequirements && (
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-slate-700 mb-2">{t('profile.requirements')}</p>
                      <ul className="text-xs text-slate-600 space-y-1">
                        <li className={clsx(
                          passwordData.newPassword.length >= passwordRequirements.passwordMinLength ? 'text-green-600' : ''
                        )}>
                          {t('profile.reqMinLength', { count: passwordRequirements.passwordMinLength })}
                        </li>
                        {passwordRequirements.passwordRequireUppercase && (
                          <li className={clsx(
                            /[A-Z]/.test(passwordData.newPassword) ? 'text-green-600' : ''
                          )}>
                            {t('profile.reqUppercase')}
                          </li>
                        )}
                        {passwordRequirements.passwordRequireLowercase && (
                          <li className={clsx(
                            /[a-z]/.test(passwordData.newPassword) ? 'text-green-600' : ''
                          )}>
                            {t('profile.reqLowercase')}
                          </li>
                        )}
                        {passwordRequirements.passwordRequireNumbers && (
                          <li className={clsx(
                            /\d/.test(passwordData.newPassword) ? 'text-green-600' : ''
                          )}>
                            {t('profile.reqNumber')}
                          </li>
                        )}
                        {passwordRequirements.passwordRequireSpecialChars && (
                          <li className={clsx(
                            /[!@#$%^&*(),.?":{}|<>]/.test(passwordData.newPassword) ? 'text-green-600' : ''
                          )}>
                            {t('profile.reqSpecial')}
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('profile.confirmPassword')}
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                  {passwordData.confirmPassword && passwordData.newPassword !== passwordData.confirmPassword && (
                    <p className="mt-1 text-xs text-red-600">{t('profile.passwordMismatch')}</p>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingPassword(false);
                      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    }}
                    className="px-4 py-2 text-slate-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    disabled={isSubmitting}
                  >
                    {t('profile.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || passwordData.newPassword !== passwordData.confirmPassword}
                    className={clsx(
                      "px-4 py-2 text-white rounded-lg transition-colors",
                      isSubmitting || passwordData.newPassword !== passwordData.confirmPassword
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-primary-600 hover:bg-primary-700"
                    )}
                  >
                    {isSubmitting ? t('profile.saving') : t('profile.changePassword')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-sm text-slate-600">
                <p className="mb-2">{t('profile.lastChanged')}</p>
                <div className="flex items-start p-3 bg-yellow-50 rounded-lg">
                  <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-yellow-800">{t('profile.securityNoticeTitle')}</p>
                    <p className="text-xs text-yellow-700 mt-1">
                      {t('profile.securityNoticeText')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card mt-6">
        <div className="flex items-center mb-3">
          <CalendarDaysIcon className="h-5 w-5 text-primary-600 mr-2" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('profile.icalTitle')}</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-gray-400 mb-3">
          {t('profile.icalDesc')}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input readOnly value={icalUrl} className="input-field flex-1 text-xs" onFocus={(e) => e.target.select()} />
          <div className="flex gap-2">
            <button type="button" onClick={copyIcal} className="btn-secondary whitespace-nowrap">{t('profile.copy')}</button>
            <button type="button" onClick={regenerateIcal} className="btn-secondary whitespace-nowrap">{t('profile.regenerate')}</button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">{t('profile.icalHint')}</p>
      </div>
    </div>
  );
}