import taskArtwork from './icon-tasks.png';
import brandAtlas from './dt-brand-icons.png';

// Equal cells in the brand artwork; unused products stay available as assets.
export const brandIconAtlas = brandAtlas;
export const taskIcon = taskArtwork;
export const brandIconCells = { platform: [0, 0], assets: [1, 0], workflow: [2, 0], link: [0, 1], income: [1, 1], notes: [2, 1], calendar: [0, 2], hrm: [1, 2], salesCommission: [2, 2] } as const;
export type FeatureIconName = keyof typeof brandIconCells | 'tasks';
