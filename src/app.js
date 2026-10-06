import { CONFIG } from './config.js';
import { parsePrediction, subjectImage } from './ai.js';
import { ReviewTracker, buildClassification } from './classification.js';
import { PanoptesClient, Auth } from './panoptes.js';
import { DEMO_PROJECT, DEMO_WORKFLOW, DEMO_SUBJECTS } from './demo.js';
import { Participant } from './participant.js';
import { SKEPTICISM_SURVEY, SIMS_SURVEY } from './surveys.js';
import { runSurvey } from './survey-view.js';

const EXPLANATION_MODES = ['on-request', 'always', 'never'];
const ADVANCE_DELAY_MS = 900;

const params = new URLSearchParams(window.location.search);
const projectId = params.get('project') || CONFIG.projectId;
const settings = {
  projectId,
  workflowId: params.get('workflow') || CONFIG.workflowId,
  environment: params.get('env') || CONFIG.environment,
  explanationMode: EXPLANATION_MODES.includes(params.get('xai')) ? params.get('xai') : CONFIG.explanationMode,
  demo: params.has('demo') || !projectId,
  debug: params.has('debug'),
  surveys: params.get('surveys') !== 'off',
};

function localStore() {
  try { return window.localStorage; } catch (_) { return null; }
}

const participant = new Participant({
  storageKey: `${CONFIG.source}:participant:${settings.demo ? 'demo' : settings.projectId}`,
  storage: localStore(),
});
if (params.has('reset')) participant.reset();

const auth = new Auth({ storageKey: `${CONFIG.source}:token` });
const client = new PanoptesClient({ environment: settings.environment, getToken: () => auth.token });

const $ = (id) => document.getElementById(id);

const state = {
  project: null,
  workflow: null,
  queue: [],
  seen: new Set(),
  current: null, // { subject, prediction, tracker }
  busy: false,
  stats: { accept: 0, reject: 0 },
};

/* ---------- Data sources ---------- */

const demoSource = {
  async load() {
    return { project: DEMO_PROJECT, workflow: DEMO_WORKFLOW };
  },
  async nextBatch() {
    // Cycle through the demo subjects forever.
    return DEMO_SUBJECTS.map(s => ({ ...s }));
  },
  async submit() {},
};

const panoptesSource = {
  async load() {
    const project = await client.getProject(settings.projectId);
    let workflowId = settings.workflowId;
    if (!workflowId) {
      workflowId = project.links?.active_workflows?.[0];
      if (!workflowId) throw new Error(`Project ${settings.projectId} has no active workflows.`);
    }
    const workflow = await client.getWorkflow(workflowId);
    return { project, workflow };
  },
  async nextBatch() {
    const subjects = await client.getQueuedSubjects(state.workflow.id, CONFIG.subjectBatchSize);
    return subjects.filter(s => !state.seen.has(String(s.id)));
  },
  async submit(classification) {
    await client.createClassification(classification);
  },
};

const source = settings.demo ? demoSource : panoptesSource;

/* ---------- Queue ---------- */

async function nextReviewable() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    while (state.queue.length) {
      const subject = state.queue.shift();
      const prediction = parsePrediction(subject, CONFIG.metadataKeys, CONFIG.labelNames);
      if (prediction) return { subject, prediction };
      state.seen.add(String(subject.id));
      console.warn(`Subject ${subject.id} has no ${CONFIG.metadataKeys.label} metadata; skipped.`);
    }
    const batch = await source.nextBatch();
    if (!batch.length) return null;
    state.queue.push(...batch);
  }
  return null;
}

function prefetch() {
  for (const subject of state.queue.slice(0, 2)) {
    const prediction = parsePrediction(subject, CONFIG.metadataKeys, CONFIG.labelNames);
    const url = subjectImage(subject, prediction);
    if (url) new Image().src = url;
  }
}

/* ---------- Rendering ---------- */

function show(stateId) {
  for (const id of ['state-loading', 'state-error', 'state-finished', 'state-review', 'state-survey']) {
    $(id).hidden = id !== stateId;
  }
}

function showError(message) {
  $('error-message').textContent = message;
  show('state-error');
}

function showWarning(message) {
  $('warning-banner').textContent = message;
  $('warning-banner').hidden = false;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderHeader() {
  $('app-title').textContent = CONFIG.title;
  document.title = CONFIG.title;
  $('project-name').textContent = state.project?.display_name || '';

  const { accept, reject } = state.stats;
  const total = accept + reject;
  $('stats').textContent = total
    ? `${total} reviewed · ${accept} accepted · ${reject} rejected`
    : '';

  const canSignIn = !settings.demo && Boolean(CONFIG.oauthClientId);
  $('auth-button').hidden = !canSignIn;
  $('auth-button').textContent = auth.token ? `Sign out${auth.login ? ` (${auth.login})` : ''}` : 'Sign in';
}

function renderBars(listId, items, { signed = false } = {}) {
  const list = $(listId);
  list.replaceChildren();
  const max = signed ? Math.max(...items.map(i => Math.abs(i.value)), 1e-9) : 1;
  for (const item of items) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'bar-name';
    name.textContent = item.displayLabel || item.name;

    const track = document.createElement('span');
    track.className = signed ? 'bar-track signed' : 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    const width = (Math.abs(item.value) / max) * (signed ? 50 : 100);
    fill.style.width = `${width}%`;
    if (signed) {
      fill.classList.add(item.value >= 0 ? 'positive' : 'negative');
      fill.style.left = item.value >= 0 ? '50%' : `${50 - width}%`;
    }
    track.append(fill);

    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = signed
      ? `${item.value >= 0 ? '+' : '−'}${Math.abs(item.value).toFixed(2)}`
      : percent(item.value);

    if (item.isPrediction) li.classList.add('is-prediction');
    li.append(name, track, value);
    list.append(li);
  }
}

function renderExamples(examples) {
  const list = $('examples');
  list.replaceChildren();
  for (const example of examples) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = example.url;
    img.alt = example.displayLabel ? `Example: ${example.displayLabel}` : 'Example image';
    img.loading = 'lazy';
    const caption = document.createElement('span');
    caption.textContent = [example.displayLabel, example.caption].filter(Boolean).join(' · ');
    li.append(img, caption);
    list.append(li);
  }
}

function renderExplanation(prediction) {
  const parts = new Set(prediction.explanationParts);
  for (const part of ['saliency', 'probabilities', 'features', 'examples', 'rationale']) {
    $(`part-${part}`).hidden = !parts.has(part);
  }
  renderBars('probability-bars', prediction.probabilities.map(p => ({
    ...p, isPrediction: p.label === prediction.label,
  })));
  renderBars('feature-bars', prediction.features, { signed: true });
  renderExamples(prediction.examples);
  $('rationale').textContent = prediction.rationale || '';
}

function renderSubject() {
  const { subject, prediction, tracker } = state.current;

  $('image-error').hidden = true;
  $('subject-image').hidden = false;
  $('subject-image').src = subjectImage(subject, prediction) || '';
  $('subject-id').textContent = subject.id;

  const slug = state.project?.slug;
  $('talk-link').hidden = !slug;
  if (slug) $('talk-link').href = `https://www.zooniverse.org/projects/${slug}/talk/subjects/${subject.id}`;

  $('ai-label').textContent = prediction.displayLabel;
  const hasConfidence = prediction.confidence !== null;
  $('confidence').hidden = !hasConfidence;
  if (hasConfidence) {
    $('confidence-fill').style.width = percent(prediction.confidence);
    $('confidence-meter').setAttribute('aria-valuenow', String(Math.round(prediction.confidence * 100)));
    $('confidence-text').textContent = `${percent(prediction.confidence)} confident`;
  }
  $('model-name').hidden = !prediction.model;
  $('model-name').textContent = prediction.model ? `Model: ${prediction.model}` : '';

  $('saliency-image').src = prediction.saliencyUrl || '';
  renderExplanation(prediction);

  $('explain-button').hidden = !tracker.explanationAvailable || settings.explanationMode === 'always';
  $('feedback').hidden = true;
  setDecisionEnabled(true);
  setExplanationOpen(settings.explanationMode === 'always' && tracker.explanationAvailable);

  show('state-review');
}

function renderSaliency() {
  const { prediction, tracker } = state.current || {};
  const visible = Boolean(prediction?.saliencyUrl && tracker?.explanationOpen && $('heatmap-toggle').checked);
  $('saliency-image').hidden = !visible;
  $('saliency-image').style.opacity = $('heatmap-opacity').value;
  $('heatmap-controls').hidden = !(prediction?.saliencyUrl && tracker?.explanationOpen);
}

function setExplanationOpen(open) {
  const { tracker } = state.current;
  if (open) tracker.openExplanation();
  else tracker.closeExplanation();
  $('explanation').hidden = !open;
  $('explain-button').setAttribute('aria-expanded', String(open));
  $('explain-button-text').textContent = open ? 'Hide explanation' : 'Why does the AI think this?';
  renderSaliency();
}

function setDecisionEnabled(enabled) {
  $('accept-button').disabled = !enabled;
  $('reject-button').disabled = !enabled;
}

function showFeedback(kind, message) {
  const el = $('feedback');
  el.className = `feedback ${kind}`;
  el.textContent = message;
  el.hidden = false;
}

/* ---------- Actions ---------- */

async function advance() {
  try {
    const next = await nextReviewable();
    if (!next) {
      state.current = null;
      show('state-finished');
      return;
    }
    state.seen.add(String(next.subject.id));
    state.current = {
      ...next,
      tracker: new ReviewTracker({ prediction: next.prediction, explanationMode: settings.explanationMode }),
    };
    renderSubject();
    prefetch();
  } catch (err) {
    showError(err.message || String(err));
  }
}

function askSurvey(survey) {
  show('state-survey');
  window.scrollTo(0, 0);
  return runSurvey($('state-survey'), survey);
}

async function decide(decision) {
  if (!state.current || state.busy) return;
  state.busy = true;
  setDecisionEnabled(false);

  const { subject, tracker } = state.current;
  const finishedAt = Date.now();
  const review = tracker.finish(decision);

  // Kept on the subject so a failed submission doesn't ask the SIMS twice.
  if (settings.surveys && participant.simsDueOnNext(CONFIG.surveys.simsEvery) && !state.current.sims) {
    const result = await askSurvey(SIMS_SURVEY);
    state.current.sims = { ...result, block: participant.data.simsCount + 1 };
    show('state-review');
  }
  const { sims } = state.current;

  const classification = buildClassification({
    project: state.project,
    workflow: state.workflow,
    subject,
    task: CONFIG.task,
    decision,
    review,
    startedAt: tracker.startedAt,
    finishedAt,
    source: CONFIG.source,
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      utcOffsetSeconds: new Date().getTimezoneOffset() * 60,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    extraMetadata: {
      participant: participant.metadata(),
      ...(sims ? { sims } : {}),
    },
  });

  try {
    await source.submit(classification);
    participant.recordClassification({ withSims: Boolean(sims) });
    if (settings.demo || settings.debug) {
      $('payload-json').textContent = JSON.stringify(classification, null, 2);
      $('payload-preview').hidden = false;
    }
    state.stats[decision] += 1;
    renderHeader();
    showFeedback('success', decision === 'accept'
      ? 'Thanks! You agreed with the AI.'
      : 'Thanks! You disagreed with the AI.');
    setTimeout(async () => {
      await advance();
      state.busy = false;
    }, ADVANCE_DELAY_MS);
  } catch (err) {
    showFeedback('error', `Could not submit: ${err.message || err}. Please try again.`);
    setDecisionEnabled(true);
    state.busy = false;
  }
}

function toggleExplanation() {
  if (!state.current?.tracker.explanationAvailable || settings.explanationMode === 'always') return;
  setExplanationOpen(!state.current.tracker.explanationOpen);
}

function onKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest?.('input, textarea, select')) return;
  if ($('state-review').hidden) return;
  const key = event.key.toLowerCase();
  if (key === 'a') decide('accept');
  else if (key === 'r') decide('reject');
  else if (key === 'e') toggleExplanation();
}

function bindEvents() {
  $('accept-button').addEventListener('click', () => decide('accept'));
  $('reject-button').addEventListener('click', () => decide('reject'));
  $('explain-button').addEventListener('click', toggleExplanation);
  $('skip-button').addEventListener('click', () => advance());
  document.addEventListener('keydown', onKeydown);

  $('subject-image').addEventListener('error', () => {
    if (!$('subject-image').getAttribute('src')) return;
    $('subject-image').hidden = true;
    $('image-error').hidden = false;
  });

  $('heatmap-toggle').addEventListener('change', (e) => {
    state.current?.tracker.record('heatmap_toggle', e.target.checked);
    renderSaliency();
  });
  $('heatmap-opacity').addEventListener('input', renderSaliency);
  $('heatmap-opacity').addEventListener('change', (e) => {
    state.current?.tracker.record('heatmap_opacity', Number(e.target.value));
  });

  $('auth-button').addEventListener('click', () => {
    if (auth.token) {
      auth.clear();
      renderHeader();
      return;
    }
    window.location.href = client.authorizeUrl({
      clientId: CONFIG.oauthClientId,
      redirectUri: window.location.origin + window.location.pathname,
    });
  });
}

function checkWorkflow(workflow) {
  const task = workflow.tasks?.[CONFIG.task.key];
  if (!task) {
    showWarning(`Workflow ${workflow.id} has no task "${CONFIG.task.key}". ` +
      'Classifications will still be sent, but will not match the workflow in exports.');
  } else if ((task.answers?.length || 0) < 2) {
    showWarning(`Task "${CONFIG.task.key}" should be a question with Accept and Reject answers.`);
  }
}

async function init() {
  bindEvents();
  $('privacy-link').href = CONFIG.links.privacyPolicy;
  $('demo-banner').hidden = !settings.demo;

  if (!settings.demo) {
    const authError = auth.consumeRedirect();
    if (authError) showWarning(`Sign-in failed: ${authError}. Check the OAuth app's redirect URI on Panoptes.`);
    if (auth.token && !auth.login) {
      try {
        const me = await client.getMe();
        auth.setLogin(me?.login || me?.display_name || null);
      } catch (_) {
        auth.clear();
      }
    }
  }
  renderHeader();

  try {
    const { project, workflow } = await source.load();
    state.project = project;
    state.workflow = workflow;
    checkWorkflow(workflow);
    renderHeader();
  } catch (err) {
    showError(err.message || String(err));
    return;
  }

  if (settings.surveys && CONFIG.surveys.skepticism && !participant.skepticism) {
    participant.setSkepticism(await askSurvey(SKEPTICISM_SURVEY));
  }

  await advance();
}

// Exposed for tests and for poking around in the console.
window.__secondLook = { state, settings, participant };

init();
