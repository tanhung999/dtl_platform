import platform from './feature-icons/platform.webp';
import assets from './feature-icons/assets.webp';
import workflow from './feature-icons/workflow.webp';
import link from './feature-icons/link.webp';
import booking from './feature-icons/booking.webp';
import income from './feature-icons/income.webp';
import notes from './feature-icons/notes.webp';
import calendar from './feature-icons/calendar.webp';
import hrm from './feature-icons/hrm.webp';
import salesCommission from './feature-icons/sales-commission.webp';
import tasks from './feature-icons/tasks.webp';

// Individual artwork keeps small icons independent of the full source sheet.
export const featureIcons = {
  platform, assets, workflow, link, booking, booking360: booking,
  income, notes, calendar, hrm, salesCommission, tasks,
} as const;
export type FeatureIconName = keyof typeof featureIcons;
