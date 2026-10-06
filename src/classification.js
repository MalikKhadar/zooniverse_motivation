/**
 * Tracks how a volunteer reached a decision on one subject and turns it into
 * a Panoptes classification.
 *
 * The decision itself is a standard single-answer question annotation, so it
 * shows up in the normal Zooniverse classification export. Everything about
 * the AI and the explanation goes in classification metadata under `ai_review`.
 */

const MAX_EVENTS = 50;

export class ReviewTracker {
  constructor({ prediction, explanationMode, clock = () => Date.now() }) {
    this.clock = clock;
    this.prediction = prediction;
    this.explanationMode = explanationMode;
    this.startedAt = clock();
    this.firstExplanationAt = null;
    this.explanationOpenSince = null;
    this.explanationDwellMs = 0;
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

  /** Freezes timings and returns the `ai_review` metadata block. */
  finish(decision) {
    const now = this.clock();
    const dwell = this.explanationDwellMs +
      (this.explanationOpen ? now - this.explanationOpenSince : 0);
    const viewed = this.firstExplanationAt !== null;
    return {
      decision,
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
      events: this.events,
    };
  }
}

export function annotationValue(decision, task) {
  if (decision === 'accept') return task.acceptAnswer;
  if (decision === 'reject') return task.rejectAnswer;
  throw new Error(`Unknown decision: ${decision}`);
}

export function buildClassification({
  project,
  workflow,
  subject,
  task,
  decision,
  review,
  startedAt,
  finishedAt,
  source,
  environment = {},
  extraMetadata = {},
}) {
  return {
    annotations: [{ task: task.key, value: annotationValue(decision, task) }],
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
