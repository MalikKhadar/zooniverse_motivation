/**
 * Offline stand-ins for a Panoptes project, workflow and subject queue, so the
 * interface can be tried without a live project. Metadata is written exactly
 * as it would arrive from a CSV manifest: every value is a string.
 */

import { CONFIG } from './config.js';

export const DEMO_PROJECT = {
  id: 'demo',
  slug: null,
  display_name: 'Tidal features (demo)',
};

export const DEMO_WORKFLOW = {
  id: 'demo',
  version: '1.1',
  tasks: {
    T0: {
      type: 'single',
      question: 'Which tidal feature does this galaxy show?',
      answers: Object.values(CONFIG.classes).map(({ name }) => ({ label: name })),
    },
  },
};

export { DEMO_SUBJECTS } from './demo-data.js';
