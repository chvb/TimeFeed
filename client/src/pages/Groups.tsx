import React, { useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import toast from 'react-hot-toast';
import ErrorBanner from '../components/ErrorBanner';
import { PlusIcon, PencilIcon, TrashIcon, UsersIcon, UserGroupIcon, XMarkIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useConfirm } from '../components/common/ConfirmProvider';
import { useAuthStore } from '../store/authStore';
import MultiSelectDropdown from '../components/common/MultiSelectDropdown';
import SearchableSelect from '../components/common/SearchableSelect';
import SearchInput from '../components/common/SearchInput';
import Select from '../components/common/Select';
import { matchesSearch } from '../lib/normalize';
import { useT } from '../i18n';

interface Group {
  id: number;
  name: string;
  description?: string;
  managerId?: number; // Keep for backward compatibility
  managerIds?: number[]; // New field for multiple managers
  parentGroupId?: number;
  companyId?: number | null;
  timeModelId?: number | null;
  surchargeProfileId?: number | null;
  createdAt: string;
  updatedAt: string;
  manager?: {
    firstName: string;
    lastName: string;
  };
  managers?: {
    id: number;
    firstName: string;
    lastName: string;
  }[]; // New field for multiple managers
  members?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  }[];
  subGroups?: Group[];
  parentGroup?: {
    name: string;
  };
}

interface GroupFormData {
  name: string;
  description: string;
  managerId?: number; // Keep for backward compatibility
  managerIds?: number[]; // New field for multiple managers
  parentGroupId?: number;
  companyId?: number | null;
  timeModelId?: number | null;
  surchargeProfileId?: number | null;
}

interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

interface GroupMembersTabProps {
  group: Group;
  allUsers: User[];
  onMembershipChange: () => void;
  canManage: boolean;
}

const GroupMembersTab: React.FC<GroupMembersTabProps> = ({
  group,
  allUsers,
  onMembershipChange,
  canManage
}) => {
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const { confirm } = useConfirm();
  const t = useT();

  useEffect(() => {
    const memberIds = group.members?.map(m => m.id) || [];
    setAvailableUsers(allUsers.filter(user => !memberIds.includes(user.id)));
  }, [group.members, allUsers]);

  const handleAddMember = async () => {
    if (!selectedUserId) return;

    try {
      await api.post(`/groups/${group.id}/members`, { userId: selectedUserId });
      setSelectedUserId(null);
      onMembershipChange();
    } catch (error) {
      console.error('Error adding member:', error);
      toast.error(t('groups.addMemberError'));
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!(await confirm({ title: t('groups.removeMemberTitle'), message: t('groups.removeMemberMessage'), confirmText: t('groups.remove'), danger: true }))) return;

    try {
      await api.delete(`/groups/${group.id}/members/${userId}`);
      onMembershipChange();
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error(t('groups.removeMemberError'));
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="text-sm font-medium text-slate-700 mb-3">{t('groups.newMember')}</h4>
          <div className="flex space-x-3">
            <div className="flex-1">
              <SearchableSelect
                value={selectedUserId ? String(selectedUserId) : ''}
                onChange={(v) => setSelectedUserId(v ? parseInt(v) : null)}
                options={availableUsers.map((user) => ({ value: String(user.id), label: `${user.firstName} ${user.lastName} (${user.email})` }))}
                placeholder={t('groups.selectEmployee')}
              />
            </div>
            <button
              onClick={handleAddMember}
              disabled={!selectedUserId}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {t('groups.addBtn')}
            </button>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium text-slate-700 mb-3">
          {t('groups.currentMembers', { count: group.members?.length || 0 })}
        </h4>
        
        {group.members && group.members.length > 0 ? (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {group.members.map((member, index) => (
              <div
                key={member.id}
                className={`flex items-center justify-between p-4 ${
                  index !== group.members!.length - 1 ? 'border-b border-gray-200' : ''
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-primary-600">
                      {member.firstName[0]}{member.lastName[0]}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {member.firstName} {member.lastName}
                    </div>
                    <div className="text-sm text-slate-600">
                      {member.email}
                    </div>
                  </div>
                </div>
                
                {canManage && (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="text-red-600 hover:text-red-900 p-1"
                    title={t('groups.removeMember')}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-600">
            <UsersIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
            <p>{t('groups.noMembers')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const Groups: React.FC = () => {
  const { user } = useAuthStore();
  const t = useT();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);
  const [timeModels, setTimeModels] = useState<{ id: number; name: string; isActive: boolean }[]>([]);
  const [surchargeProfiles, setSurchargeProfiles] = useState<{ id: number; name: string; isActive: boolean }[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'members'>('details');
  const [sortField, setSortField] = useState<'name' | 'manager' | 'parent' | 'members'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [formData, setFormData] = useState<GroupFormData>({
    name: '',
    description: '',
    managerId: undefined,
    managerIds: [],
    parentGroupId: undefined
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [groupsResponse, usersResponse] = await Promise.all([
        api.get('/groups'),
        api.get('/users')
      ]);
      
      setGroups(groupsResponse.data.groups || groupsResponse.data);
      const usersData = usersResponse.data.users || usersResponse.data;
      setAllUsers(usersData);
      setUsers(usersData.filter((u: User) => u.role === 'verwaltung' || u.role === 'admin' || u.role === 'buchhaltung'));
      if (user?.isSuperAdmin) {
        try { const cr = await api.get('/companies'); setCompanies(cr.data.companies || []); } catch { /* ignore */ }
      }
      // Zeitmodelle der Firma für die Zuordnung im Formular (Fehler still ignorieren).
      try {
        const tmr = await api.get('/time-models');
        setTimeModels(tmr.data.timeModels || tmr.data.models || (Array.isArray(tmr.data) ? tmr.data : []));
      } catch { /* ignore */ }
      // Zuschlagsprofile der Firma für die Zuordnung im Formular (Fehler still ignorieren).
      try {
        const spr = await api.get('/surcharge-profiles');
        setSurchargeProfiles(spr.data.surchargeProfiles || []);
      } catch { /* ignore */ }
      setLoadError('');
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError(t('groups.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const submitData: any = {
        name: formData.name,
        description: formData.description
      };

      // Only include fields if they have a value (not null/undefined/empty)
      if (formData.managerId) {
        submitData.managerId = formData.managerId;
      }
      if (formData.managerIds && formData.managerIds.length > 0) {
        submitData.managerIds = formData.managerIds;
      }
      if (formData.parentGroupId) {
        submitData.parentGroupId = formData.parentGroupId;
      }
      // Zeitmodell-Zuordnung immer mitsenden (null = kein Zeitmodell).
      submitData.timeModelId = formData.timeModelId ?? null;
      // Zuschlagsprofil-Zuordnung immer mitsenden (null = kein Zuschlagsprofil).
      submitData.surchargeProfileId = formData.surchargeProfileId ?? null;
      if (user?.isSuperAdmin) {
        submitData.companyId = formData.companyId ?? null;
      }

      if (editingGroup) {
        await api.put(`/groups/${editingGroup.id}`, submitData);
      } else {
        await api.post('/groups', submitData);
      }

      await fetchData();
      resetForm();
    } catch (error) {
      console.error('Error saving group:', error);
      toast.error((error as any)?.response?.data?.message || t('groups.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirm({ title: t('groups.deleteTitle'), message: t('groups.deleteMessage'), confirmText: t('groups.delete'), danger: true }))) return;
    
    try {
      await api.delete(`/groups/${id}`);
      fetchData();
    } catch (error) {
      console.error('Error deleting group:', error);
    }
  };

  const handleEdit = (group: Group) => {
    setEditingGroup(group);
    setActiveTab('details');
    setFormData({
      name: group.name,
      description: group.description || '',
      managerId: group.managerId,
      managerIds: group.managerIds || (group.managerId ? [group.managerId] : []),
      parentGroupId: group.parentGroupId,
      companyId: group.companyId ?? null,
      timeModelId: group.timeModelId ?? null,
      surchargeProfileId: group.surchargeProfileId ?? null
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setShowModal(false);
    setEditingGroup(null);
    setActiveTab('details');
    setFormData({
      name: '',
      description: '',
      managerId: undefined,
      managerIds: [],
      parentGroupId: undefined,
      timeModelId: null,
      surchargeProfileId: null
    });
  };

  const handleSort = (field: 'name' | 'manager' | 'parent' | 'members') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  const SortButton = ({ field, children }: { field: 'name' | 'manager' | 'parent' | 'members', children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center space-x-1 hover:text-slate-900 transition-colors cursor-pointer"
    >
      <span>{children}</span>
      {sortField === field ? (
        sortDirection === 'asc' ? (
          <ChevronUpIcon className="h-4 w-4" />
        ) : (
          <ChevronDownIcon className="h-4 w-4" />
        )
      ) : (
        <div className="h-4 w-4" />
      )}
    </button>
  );

  const getGroupTree = (parentId: number | null = null, level = 0): Group[] => {
    // Firmen-Filterung erfolgt serverseitig über den globalen Firmen-Wechsler (Header).
    let filteredGroups = groups.filter(group => group.parentGroupId === parentId);
    
    // Sort groups at this level
    filteredGroups.sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortField) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'manager':
          aValue = a.managers && a.managers.length > 0 
            ? a.managers.map(m => `${m.firstName} ${m.lastName}`).join(', ')
            : (a.manager ? `${a.manager.firstName} ${a.manager.lastName}` : '');
          bValue = b.managers && b.managers.length > 0 
            ? b.managers.map(m => `${m.firstName} ${m.lastName}`).join(', ')
            : (b.manager ? `${b.manager.firstName} ${b.manager.lastName}` : '');
          break;
        case 'parent':
          aValue = a.parentGroup?.name || '';
          bValue = b.parentGroup?.name || '';
          break;
        case 'members':
          aValue = a.members?.length || 0;
          bValue = b.members?.length || 0;
          break;
        default:
          aValue = a.name;
          bValue = b.name;
      }
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filteredGroups.map(group => ({
      ...group,
      level,
      subGroups: getGroupTree(group.id, level + 1)
    }));
  };

  const renderGroupRow = (group: Group & { level?: number }) => {
    const indent = (group.level || 0) * 20;
    
    return (
      <React.Fragment key={group.id}>
        <tr className="hover:bg-slate-50">
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="flex items-center" style={{ paddingLeft: `${indent}px` }}>
              <div className="flex items-center">
                <UserGroupIcon className="h-5 w-5 text-slate-500 mr-3" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {group.name}
                  </div>
                  {group.description && (
                    <div className="text-sm text-slate-600">
                      {group.description}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
            {group.managers && group.managers.length > 0 
              ? group.managers.map(manager => `${manager.firstName} ${manager.lastName}`).join(', ')
              : (group.manager ? `${group.manager.firstName} ${group.manager.lastName}` : '-')
            }
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
            {group.parentGroup?.name || t('groups.mainGroup')}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
            <div className="flex items-center">
              <UsersIcon className="h-4 w-4 mr-1" />
              {group.members?.length || 0}
            </div>
          </td>
          {(user?.role === 'admin' || user?.role === 'buchhaltung') && (
            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => handleEdit(group)}
                  className="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-400"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(group.id)}
                  className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </td>
          )}
        </tr>
        {group.subGroups?.map(subGroup => renderGroupRow(subGroup))}
      </React.Fragment>
    );
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">{t('groups.title')}</h1>
        <div className="card">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4"></div>
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const groupTree = getGroupTree();
  const searching = groupSearch.trim() !== '';
  const flatMatches = searching
    ? groups.filter((g) => matchesSearch(`${g.name} ${g.description || ''}`, groupSearch))
    : [];
  const hasRows = searching ? flatMatches.length > 0 : groupTree.length > 0;

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={fetchData} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <h1 className="text-3xl font-bold text-slate-900">{t('groups.title')}</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="w-full sm:w-64">
            <SearchInput value={groupSearch} onChange={setGroupSearch} placeholder={t('groups.searchPlaceholder')} />
          </div>
          {(user?.role === 'admin' || user?.role === 'buchhaltung') && (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex items-center space-x-2"
            >
              <PlusIcon className="h-5 w-5" />
              <span>{t('groups.add')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
        <div className="card">
          <div className="flex items-center">
            <UserGroupIcon className="h-8 w-8 text-primary-600 mr-3" />
            <div>
              <div className="text-2xl font-bold text-slate-900">
                {groups.length}
              </div>
              <div className="text-sm text-slate-600">
                {t('groups.statGroups')}
              </div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <UsersIcon className="h-8 w-8 text-green-600 mr-3" />
            <div>
              <div className="text-2xl font-bold text-slate-900">
                {groups.reduce((total, group) => total + (group.members?.length || 0), 0)}
              </div>
              <div className="text-sm text-slate-600">
                {t('groups.statMembers')}
              </div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <UserGroupIcon className="h-8 w-8 text-primary-600 mr-3" />
            <div>
              <div className="text-2xl font-bold text-slate-900">
                {groups.filter(g => !g.parentGroupId).length}
              </div>
              <div className="text-sm text-slate-600">
                {t('groups.statMainGroups')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Groups Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="name">{t('groups.colGroup')}</SortButton>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="manager">{t('groups.colManager')}</SortButton>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="parent">{t('groups.colParent')}</SortButton>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                  <SortButton field="members">{t('groups.colMembers')}</SortButton>
                </th>
                {(user?.role === 'admin' || user?.role === 'buchhaltung') && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">
                    {t('groups.colActions')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {hasRows ? (
                searching
                  ? flatMatches.map(group => renderGroupRow({ ...group, level: 0 }))
                  : groupTree.map(group => renderGroupRow(group))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-sm text-slate-600">
                    {t('groups.emptyTable')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for Add/Edit Group */}
      <Transition appear show={showModal} as={React.Fragment}>
        <Dialog as="div" className="relative z-50" onClose={resetForm}>
          <Transition.Child as={React.Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50" aria-hidden="true" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full justify-center p-4 pt-20">
              <Dialog.Panel className="relative mx-4 p-5 border w-full md:w-2/3 lg:w-1/2 max-h-[90vh] overflow-y-auto shadow-lg rounded-md bg-white">
            <div className="absolute top-3 right-3">
              <button
                onClick={resetForm}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                title={t('groups.close')}
              >
                <XMarkIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
              </button>
            </div>
            <div className="mt-3">
              <h3 className="text-lg font-medium text-slate-900 mb-4">
                {editingGroup ? t('groups.editTitle') : t('groups.addTitle')}
              </h3>
              
              {editingGroup && (
                <div className="flex flex-wrap border-b border-gray-200 mb-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab('details')}
                    className={`py-2 px-4 text-sm font-medium ${
                      activeTab === 'details'
                        ? 'border-b-2 border-primary-500 text-primary-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t('groups.tabDetails')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('members')}
                    className={`py-2 px-4 text-sm font-medium ${
                      activeTab === 'members'
                        ? 'border-b-2 border-primary-500 text-primary-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t('groups.tabMembers', { count: editingGroup.members?.length || 0 })}
                  </button>
                </div>
              )}
              
              {activeTab === 'details' && (
                <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('groups.groupName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="input-field"
                    placeholder={t('groups.groupNamePlaceholder')}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('groups.description')}
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="input-field"
                    rows={3}
                    placeholder={t('groups.descriptionPlaceholder')}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('groups.colManager')}
                  </label>
                  <MultiSelectDropdown
                    options={users.map(user => ({
                      id: user.id,
                      label: `${user.firstName} ${user.lastName} (${user.role})`
                    }))}
                    selectedValues={formData.managerIds || []}
                    onChange={(selectedIds) => setFormData({...formData, managerIds: selectedIds})}
                    placeholder={t('groups.managerPlaceholder')}
                    searchPlaceholder={t('groups.managerSearchPlaceholder')}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('groups.parentGroup')}
                  </label>
                  <Select
                    value={formData.parentGroupId ? String(formData.parentGroupId) : ''}
                    onChange={(v) => setFormData({...formData, parentGroupId: v ? parseInt(v) : undefined})}
                    options={[
                      { value: '', label: t('groups.noParentGroup') },
                      ...groups
                        .filter(g => !editingGroup || g.id !== editingGroup.id)
                        .map(group => ({ value: String(group.id), label: group.name })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('groups.timeModel')}
                  </label>
                  <Select
                    value={formData.timeModelId != null ? String(formData.timeModelId) : ''}
                    onChange={(v) => setFormData({ ...formData, timeModelId: v ? parseInt(v) : null })}
                    options={[
                      { value: '', label: t('groups.noTimeModel') },
                      ...timeModels.map((tm) => ({ value: String(tm.id), label: `${tm.name}${tm.isActive === false ? ` (${t('groups.timeModelInactive')})` : ''}` })),
                    ]}
                  />
                  <p className="text-xs text-slate-400 mt-1">{t('groups.timeModelHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('groups.surchargeProfile')}
                  </label>
                  <Select
                    value={formData.surchargeProfileId != null ? String(formData.surchargeProfileId) : ''}
                    onChange={(v) => setFormData({ ...formData, surchargeProfileId: v ? parseInt(v) : null })}
                    options={[
                      { value: '', label: t('groups.noSurchargeProfile') },
                      ...surchargeProfiles.map((sp) => ({ value: String(sp.id), label: `${sp.name}${sp.isActive === false ? ` (${t('groups.surchargeProfileInactive')})` : ''}` })),
                    ]}
                  />
                  <p className="text-xs text-slate-400 mt-1">{t('groups.surchargeProfileHint')}</p>
                </div>

                {user?.isSuperAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t('groups.company')}</label>
                    <Select
                      value={formData.companyId != null ? String(formData.companyId) : ''}
                      onChange={(v) => setFormData({ ...formData, companyId: v ? parseInt(v) : null })}
                      options={[
                        { value: '', label: t('groups.noCompany') },
                        ...companies.map((c) => ({ value: String(c.id), label: c.name })),
                      ]}
                    />
                  </div>
                )}

                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="btn-secondary"
                    >
                      {t('groups.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={saving}
                    >
                      {saving ? t('groups.saving') : (editingGroup ? t('groups.save') : t('groups.addBtn'))}
                    </button>
                  </div>
                </form>
              )}
              
              {activeTab === 'members' && editingGroup && (
                <GroupMembersTab
                  group={editingGroup}
                  allUsers={allUsers}
                  onMembershipChange={() => fetchData()}
                  canManage={user?.role === 'admin' || user?.role === 'buchhaltung'}
                />
              )}
            </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
};

export default Groups;