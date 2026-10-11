/**
 * Offline stand-ins for a Panoptes project, workflow and subject queue, so the
 * interface can be tried without a live project. Metadata is written exactly
 * as it would arrive from a CSV manifest: every value is a string.
 */

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
      question: 'Do you agree with the AI?',
      answers: [{ label: 'Accept' }, { label: 'Reject' }],
    },
  },
};

export { DEMO_SUBJECTS } from './demo-data.js';
