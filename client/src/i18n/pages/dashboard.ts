// Seitenweise Übersetzungen für das Dashboard (Begrüßung) + EmployeeDetailModal.
// Die Stempeluhr-Texte liegen in i18n/pages/time.ts.
export const dashboard = {
  de: {
    dashboard: {
      welcomeBack: 'Willkommen zurück, {{name}}!',
      subtitle: 'Ihre Zeiterfassung im Überblick.',
      today: 'Heute',
    },
    // EmployeeDetailModal (Stammdaten)
    widgets: {
      role: {
        admin: 'Admin',
        buchhaltung: 'Buchhaltung',
        verwaltung: 'Verwaltung',
        mitarbeiter: 'Mitarbeiter',
      },
      labelRole: 'Rolle',
      labelEmployeeNumber: 'Personalnummer',
      labelDepartment: 'Abteilung/Gruppe',
      labelPosition: 'Position',
      labelEntry: 'Eintritt',
      labelStatus: 'Status',
      active: 'Aktiv',
      inactive: 'Inaktiv',
    },
  },
  en: {
    dashboard: {
      welcomeBack: 'Welcome back, {{name}}!',
      subtitle: 'Your time tracking at a glance.',
      today: 'Today',
    },
    // EmployeeDetailModal (master data)
    widgets: {
      role: {
        admin: 'Admin',
        buchhaltung: 'Accounting',
        verwaltung: 'Administration',
        mitarbeiter: 'Employee',
      },
      labelRole: 'Role',
      labelEmployeeNumber: 'Employee number',
      labelDepartment: 'Department/Group',
      labelPosition: 'Position',
      labelEntry: 'Start date',
      labelStatus: 'Status',
      active: 'Active',
      inactive: 'Inactive',
    },
  },
};
