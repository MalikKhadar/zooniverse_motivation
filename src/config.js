/**
 * Everything a project team is expected to change lives here. URL parameters
 * override the matching fields at runtime (see README → "URL parameters").
 */
export const CONFIG = {
  title: 'Second Look',

  // Leave projectId empty to run against the bundled demo subjects.
  projectId: '',
  workflowId: '',
  environment: 'production', // 'production' | 'staging'

  subjectBatchSize: 10,

  // Register an OAuth application on Panoptes with this page's URL as the
  // redirect URI and paste its client ID here. Empty = anonymous only.
  oauthClientId: '',

  // The workflow needs one single-answer question task. Its answer order
  // decides the annotation value: accept → acceptAnswer, reject → rejectAnswer.
  task: {
    key: 'T0',
    acceptAnswer: 0,
    rejectAnswer: 1,
  },

  // How explanations are offered:
  //   'on-request' – a "Why?" button reveals the explanation (default)
  //   'always'     – the explanation is open from the start
  //   'never'      – no explanation, accept/reject only (control condition)
  explanationMode: 'on-request',

  // Subject metadata keys holding the model output. A leading '#' hides a
  // field from volunteers in the standard Zooniverse metadata viewer.
  metadataKeys: {
    label: '#ai_label',
    confidence: '#ai_confidence',
    probabilities: '#ai_probabilities',
    saliency: '#ai_saliency',
    rationale: '#ai_rationale',
    features: '#ai_features',
    examples: '#ai_examples',
    model: '#ai_model',
  },

  // Human-friendly names for raw model labels. Unlisted labels are shown as-is.
  labelNames: {
    spiral: 'Spiral galaxy',
    elliptical: 'Elliptical galaxy',
    edge_on: 'Edge-on disk',
    merger: 'Merging galaxies',
  },

  // Written to classification metadata so exports can tell this front end apart.
  source: 'second-look',

  links: {
    privacyPolicy: 'https://www.zooniverse.org/privacy',
  },
};
