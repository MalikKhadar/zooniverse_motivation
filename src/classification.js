/**
 * Tracks how a volunteer reached a decision on one subject and turns it into
 * a Panoptes classification.
 *
 * The volunteer's answer is a standard single-answer question annotation (the
 * index of the class they chose), so it shows up in the normal Zooniverse
 * classification export. Keeping the AI's preselected class is an accept;
 * choosing any other class is a reject. Everything about the AI and the
 * explanation goes in classification metadata under `ai_review`.
 */

const MAX_EVENTS = 100;

export class ReviewTracker {
  constructor({ prediction, explanationMode, clock = () => Date.now() }) {
    this.clock = clock;
    this.prediction = prediction;
    this.explanationMode = explanationMode;
    this.startedAt = clock();
    this.firstExplanationAt = null;
    this.explanationOpenSince = null;
    this.explanationDwellMs = 0;
    this.examplesViewed = [];
    this.events = [];
  }

  get explanationAvailable() {
    return this.explanationMode !== 'never' && (this.prediction?.explanationParts?.length || 0) > 0;
  }

  get explanationOpen() {
    return this.explanationOpenSince !== null;
  }

  record(type, detail) {
    if (this.events.length >= MAX_EVENTS) return;
    const event = { type, t_ms: this.clock() - this.startedAt };
    if (detail !== undefined) event.detail = detail;
    this.events.push(event);
  }

  openExplanation() {
    if (this.explanationOpen) return;
    const now = this.clock();
    if (this.firstExplanationAt === null) this.firstExplanationAt = now;
    this.explanationOpenSince = now;
    this.record('explanation_open');
  }

  closeExplanation() {
    if (!this.explanationOpen) return;
    this.explanationDwellMs += this.clock() - this.explanationOpenSince;
    this.explanationOpenSince = null;
    this.record('explanation_close');
  }

  /** Factual for the AI's own class, counterfactual for any other. */
  openExamples(label) {
    const kind = label === this.prediction?.label ? 'factual' : 'counterfactual';
    if (!this.examplesViewed.includes(label)) this.examplesViewed.push(label);
    this.record('examples_open', { label, kind });
  }

  closeExamples(label) {
    this.record('examples_close', { label });
  }

  /** Freezes timings and returns the `ai_review` metadata block. */
  finish(chosenLabel) {
    const now = this.clock();
    const decision = chosenLabel === this.prediction?.label ? 'accept' : 'reject';
    const dwell = this.explanationDwellMs +
      (this.explanationOpen ? now - this.explanationOpenSince : 0);
    const viewed = this.firstExplanationAt !== null;
    return {
      decision,
      chosen_label: chosenLabel,
      ai_label: this.prediction?.label ?? null,
      ai_confidence: this.prediction?.confidence ?? null,
      ai_model: this.prediction?.model ?? null,
      explanation_mode: this.explanationMode,
      explanation_available: this.explanationAvailable,
      explanation_parts: this.explanationAvailable ? this.prediction.explanationParts : [],
      explanation_viewed: viewed,
      decision_path: viewed ? 'after_explanation' : 'direct',
      time_to_decision_ms: now - this.startedAt,
      time_to_explanation_ms: viewed ? this.firstExplanationAt - this.startedAt : null,
      explanation_dwell_ms: dwell,
      selection_changes: this.events.filter(e => e.type === 'select').length,
      examples_viewed: [...this.examplesViewed],
      counterfactual_viewed: this.examplesViewed.some(label => label !== this.prediction?.label),
      events: this.events,
    };
  }
}

/** The answer index for a class: the workflow's answers follow `labels`. */
export function answerIndex(label, labels) {
  const index = labels.indexOf(label);
  if (index === -1) throw new Error(`Unknown class: ${label}`);
  return index;
}

export function buildClassification({
  project,
  workflow,
  subject,
  task,
  answer,
  review,
  startedAt,
  finishedAt,
  source,
  environment = {},
  extraMetadata = {},
}) {
  return {
    annotations: [{ task: task.key, value: answer }],
    metadata: {
      workflow_version: workflow.version || '1.0',
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      user_agent: environment.userAgent || '',
      user_language: environment.language || '',
      utc_offset: String(environment.utcOffsetSeconds ?? 0),
      viewport: environment.viewport || null,
      source,
      ai_review: review,
      ...extraMetadata,
    },
    links: {
      project: String(project.id),
      workflow: String(workflow.id),
      subjects: [String(subject.id)],
    },
    completed: true,
  };
}
