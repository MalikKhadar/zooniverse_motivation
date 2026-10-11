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

  // The workflow needs one single-answer question task whose answers are the
  // classes below, in the same order. The annotation value is the index of the
  // class the volunteer submits.
  task: {
    key: 'T0',
  },

  // How explanations are offered:
  //   'on-request' – a "Why?" button reveals the explanation (default)
  //   'always'     – the explanation is open from the start
  //   'never'      – no explanation, accept/reject only (control condition)
  explanationMode: 'on-request',

  // Questionnaires (definitions in src/surveys.js). Answers travel in
  // classification metadata; `?surveys=off` disables both for a visit.
  surveys: {
    skepticism: true, // AI skepticism questions on a volunteer's first visit
    checkInEvery: 5,  // needs check-in (autonomy, competence, relatedness) after every Nth classification; 0 = never
  },

  // Subject metadata keys holding the model output. A leading '#' hides a
  // field from volunteers in the standard Zooniverse metadata viewer.
  metadataKeys: {
    label: '#ai_label',
    confidence: '#ai_confidence',
    probabilities: '#ai_probabilities',
    saliency: '#ai_saliency',
    examples: '#ai_examples',
    model: '#ai_model',
  },

  // The classes the model chooses between, keyed by the raw model label, in
  // the order of the workflow's answers: a display name and a silhouette (any
  // single-colour SVG or transparent PNG, tinted to match the theme). Subjects
  // whose AI label is not listed here are skipped.
  classes: {
    longtail: { name: 'Long tail', icon: 'assets/classes/longtail.png' },
    onearm: { name: 'One arm', icon: 'assets/classes/onearm.png' },
    twoarm: { name: 'Two arms', icon: 'assets/classes/twoarm.png' },
    ring: { name: 'Ring', icon: 'assets/classes/ring.png' },
    shell: { name: 'Shell', icon: 'assets/classes/shell.png' },
    stream: { name: 'Stream', icon: 'assets/classes/stream.png' },
  },

  // Written to classification metadata so exports can tell this front end apart.
  source: 'second-look',

  links: {
    privacyPolicy: 'https://www.zooniverse.org/privacy',
  },
};

export const LABEL_NAMES = Object.fromEntries(
  Object.entries(CONFIG.classes).map(([label, { name }]) => [label, name]),
);

export const CLASS_LABELS = Object.keys(CONFIG.classes);
