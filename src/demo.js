/**
 * Offline stand-ins for a Panoptes project, workflow and subject queue, so the
 * interface can be tried without a live project. Metadata is written exactly
 * as it would arrive from a CSV manifest: every value is a string.
 */

export const DEMO_PROJECT = {
  id: 'demo',
  slug: null,
  display_name: 'Second Look (demo)',
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

const examples = JSON.stringify([
  { url: 'demo/example-spiral-1.jpg', label: 'spiral', caption: 'Training example' },
  { url: 'demo/example-spiral-2.jpg', label: 'spiral', caption: 'Training example' },
  { url: 'demo/example-elliptical-1.jpg', label: 'elliptical', caption: 'Training example' },
  { url: 'demo/example-edge-on-1.jpg', label: 'edge_on', caption: 'Training example' },
]);

const subject = (id, name, metadata) => ({
  id,
  locations: [
    { 'image/jpeg': `demo/subject-${name}.jpg` },
    { 'image/png': `demo/subject-${name}-saliency.png` },
  ],
  metadata: {
    '#ai_saliency': '1',
    '#ai_model': 'toy-cnn-v0.3',
    '#ai_examples': examples,
    ...metadata,
  },
});

export const DEMO_SUBJECTS = [
  subject('demo-1', 'spiral', {
    '#ai_label': 'spiral',
    '#ai_confidence': '0.91',
    '#ai_probabilities': '{"spiral":0.91,"elliptical":0.04,"edge_on":0.03,"merger":0.02}',
    '#ai_features': '[{"name":"Arm-like structure","value":0.62},{"name":"Bright central bulge","value":0.18},{"name":"Smooth light profile","value":-0.21},{"name":"Elongation","value":-0.05}]',
    '#ai_rationale': 'The model found curved bands of light winding out from a central bulge, which is typical of spiral galaxies.',
  }),
  subject('demo-2', 'elliptical', {
    '#ai_label': 'elliptical',
    '#ai_confidence': '0.84',
    '#ai_probabilities': '{"elliptical":0.84,"merger":0.08,"spiral":0.06,"edge_on":0.02}',
    '#ai_features': '[{"name":"Smooth light profile","value":0.55},{"name":"Arm-like structure","value":-0.30},{"name":"Elongation","value":0.08}]',
    '#ai_rationale': 'The light fades smoothly from the centre with no visible arms or dust lanes.',
  }),
  subject('demo-3', 'edge-on', {
    // A deliberate mistake: the model fixates on the bulge and says "spiral".
    '#ai_label': 'spiral',
    '#ai_confidence': '0.58',
    '#ai_probabilities': '{"spiral":0.58,"edge_on":0.33,"elliptical":0.07,"merger":0.02}',
    '#ai_features': '[{"name":"Bright central bulge","value":0.41},{"name":"Elongation","value":-0.36},{"name":"Arm-like structure","value":0.12}]',
    '#ai_rationale': 'The model focused on the bright centre. It is less sure because the galaxy is very elongated, which it also associates with edge-on disks.',
  }),
  subject('demo-4', 'merger', {
    '#ai_label': 'elliptical',
    '#ai_confidence': '47%',
    '#ai_probabilities': '{"elliptical":0.47,"merger":0.41,"spiral":0.09,"edge_on":0.03}',
    '#ai_features': '[{"name":"Smooth light profile","value":0.33},{"name":"Second bright core","value":-0.29},{"name":"Tidal features","value":-0.12}]',
    '#ai_rationale': 'The model saw a smooth, bright core but only weighed one of the two cores in the image.',
  }),
];
