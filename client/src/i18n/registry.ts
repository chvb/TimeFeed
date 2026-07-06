// Aggregiert die seitenweisen Übersetzungs-Module (i18n/pages/*).
import { dashboard } from './pages/dashboard';
import { people } from './pages/people';
import { settings } from './pages/settings';
import { companiesPages } from './pages/companies';
import { uiPages } from './pages/ui';
import { time } from './pages/time';
import { timeModels } from './pages/timeModels';
import { terminal } from './pages/terminal';
import { manageTimes } from './pages/manageTimes';
import { corrections } from './pages/corrections';
import { presence } from './pages/presence';
import { exportsPage } from './pages/exports';

export const pagesDe: Record<string, any> = {
  ...dashboard.de, ...people.de, ...settings.de, ...companiesPages.de, ...uiPages.de, ...time.de, ...timeModels.de, ...terminal.de,
  ...manageTimes.de, ...corrections.de, ...presence.de, ...exportsPage.de,
};
export const pagesEn: Record<string, any> = {
  ...dashboard.en, ...people.en, ...settings.en, ...companiesPages.en, ...uiPages.en, ...time.en, ...timeModels.en, ...terminal.en,
  ...manageTimes.en, ...corrections.en, ...presence.en, ...exportsPage.en,
};
