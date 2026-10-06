import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrediction, parseConfidence, safeUrl, subjectImage } from '../src/ai.js';
import { ReviewTracker, buildClassification, annotationValue } from '../src/classification.js';
import { Auth, PanoptesClient } from '../src/panoptes.js';
import { CONFIG } from '../src/config.js';
import { DEMO_SUBJECTS } from '../src/demo.js';
import { SKEPTICISM_SURVEY, NEEDS_SURVEY, scoreSurvey, isComplete } from '../src/surveys.js';
import { Participant } from '../src/participant.js';

const KEYS = CONFIG.metadataKeys;

const subject = (metadata, locations = [{ 'image/jpeg': 'https://example.org/a.jpg' }]) =>
  ({ id: '42', metadata, locations });

test('parseConfidence accepts fractions, percentages and percent strings', () => {
  assert.equal(parseConfidence('0.87'), 0.87);
  assert.equal(parseConfidence('87'), 0.87);
  assert.equal(parseConfidence('87%'), 0.87);
  assert.equal(parseConfidence(1), 1);
  assert.equal(parseConfidence('abc'), null);
  assert.equal(parseConfidence('-1'), null);
  assert.equal(parseConfidence('150'), null);
  assert.equal(parseConfidence(''), null);
});

test('safeUrl allows http(s) and relative URLs only', () => {
  assert.equal(safeUrl('https://x.org/a.png'), 'https://x.org/a.png');
  assert.equal(safeUrl('demo/a.png'), 'demo/a.png');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:image/png;base64,AAAA'), null);
  assert.equal(safeUrl('//evil.example/a.png'), null);
});

test('subjects without an AI label are not reviewable', () => {
  assert.equal(parsePrediction(subject({}), KEYS), null);
  assert.equal(parsePrediction(subject({ '#ai_label': '  ' }), KEYS), null);
});

test('label only: no explanation parts', () => {
  const p = parsePrediction(subject({ '#ai_label': 'spiral' }), KEYS, { spiral: 'Spiral galaxy' });
  assert.equal(p.label, 'spiral');
  assert.equal(p.displayLabel, 'Spiral galaxy');
  assert.equal(p.confidence, null);
  assert.deepEqual(p.explanationParts, []);
});

test('full CSV-style metadata is parsed and sorted', () => {
  const p = parsePrediction(subject({
    '#ai_label': 'b',
    '#ai_probabilities': '{"a":0.2,"b":0.7,"c":0.1}',
    '#ai_features': '[{"name":"x","value":0.1},{"name":"y","value":-0.5}]',
    '#ai_examples': '["https://ex.org/1.jpg", {"url":"javascript:bad"}, {"url":"rel.jpg","label":"a"}]',
    '#ai_rationale': 'Because.',
    '#ai_saliency': 'https://ex.org/heat.png',
  }), KEYS);
  assert.equal(p.confidence, 0.7, 'falls back to the label probability');
  assert.deepEqual(p.probabilities.map(x => x.label), ['b', 'a', 'c']);
  assert.deepEqual(p.features.map(x => x.name), ['y', 'x']);
  assert.deepEqual(p.examples.map(x => x.url), ['https://ex.org/1.jpg', 'rel.jpg']);
  assert.equal(p.saliencyUrl, 'https://ex.org/heat.png');
  assert.deepEqual(p.explanationParts, ['saliency', 'probabilities', 'features', 'examples', 'rationale']);
});

test('malformed JSON fields are dropped, not fatal', () => {
  const p = parsePrediction(subject({
    '#ai_label': 'a', '#ai_probabilities': '{oops', '#ai_features': 'nope', '#ai_examples': '{}',
  }), KEYS);
  assert.deepEqual(p.probabilities, []);
  assert.deepEqual(p.features, []);
  assert.deepEqual(p.examples, []);
});

test('saliency can point at one of the subject locations', () => {
  const s = subject({ '#ai_label': 'a', '#ai_saliency': '1' }, [
    { 'image/jpeg': 'https://cdn/subject.jpg' },
    { 'image/png': 'https://cdn/heat.png' },
  ]);
  const p = parsePrediction(s, KEYS);
  assert.equal(p.saliencyUrl, 'https://cdn/heat.png');
  assert.equal(subjectImage(s, p), 'https://cdn/subject.jpg');

  const missing = parsePrediction({ ...s, metadata: { '#ai_label': 'a', '#ai_saliency': 'location:5' } }, KEYS);
  assert.equal(missing.saliencyUrl, null);
});

test('every demo subject is reviewable with a full explanation', () => {
  for (const s of DEMO_SUBJECTS) {
    const p = parsePrediction(s, KEYS, CONFIG.labelNames);
    assert.ok(p, s.id);
    assert.equal(p.explanationParts.length, 5, s.id);
    assert.ok(subjectImage(s, p).endsWith('.jpg'), s.id);
  }
});

function fakeClock(start = 1_000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
}

const prediction = { label: 'a', confidence: 0.8, model: 'm', explanationParts: ['rationale'] };

test('direct decision without opening the explanation', () => {
  const clock = fakeClock();
  const t = new ReviewTracker({ prediction, explanationMode: 'on-request', clock });
  clock.advance(1500);
  const r = t.finish('accept');
  assert.equal(r.decision_path, 'direct');
  assert.equal(r.explanation_viewed, false);
  assert.equal(r.time_to_decision_ms, 1500);
  assert.equal(r.time_to_explanation_ms, null);
  assert.equal(r.explanation_dwell_ms, 0);
});

test('dwell time sums open periods, including one still open at decision', () => {
  const clock = fakeClock();
  const t = new ReviewTracker({ prediction, explanationMode: 'on-request', clock });
  clock.advance(1000); t.openExplanation();
  clock.advance(2000); t.closeExplanation();
  clock.advance(500); t.openExplanation();
  clock.advance(700);
  const r = t.finish('reject');
  assert.equal(r.decision_path, 'after_explanation');
  assert.equal(r.time_to_explanation_ms, 1000);
  assert.equal(r.explanation_dwell_ms, 2700);
  assert.deepEqual(r.events.map(e => e.type), ['explanation_open', 'explanation_close', 'explanation_open']);
});

test("'never' mode reports no explanation available", () => {
  const t = new ReviewTracker({ prediction, explanationMode: 'never' });
  assert.equal(t.explanationAvailable, false);
  assert.deepEqual(t.finish('accept').explanation_parts, []);
});

test('annotation values follow the configured answer order', () => {
  const task = { key: 'T0', acceptAnswer: 0, rejectAnswer: 1 };
  assert.equal(annotationValue('accept', task), 0);
  assert.equal(annotationValue('reject', task), 1);
  assert.throws(() => annotationValue('maybe', task));
});

test('classification payload matches the Panoptes contract', () => {
  const c = buildClassification({
    project: { id: 1 }, workflow: { id: 2, version: '3.4' }, subject: { id: 5 },
    task: { key: 'T0', acceptAnswer: 0, rejectAnswer: 1 }, decision: 'reject',
    review: { decision: 'reject' }, startedAt: 0, finishedAt: 1000, source: 'test',
    environment: { userAgent: 'ua', language: 'en', utcOffsetSeconds: -3600, viewport: { width: 1, height: 2 } },
  });
  assert.deepEqual(c.annotations, [{ task: 'T0', value: 1 }]);
  assert.deepEqual(c.links, { project: '1', workflow: '2', subjects: ['5'] });
  assert.equal(c.metadata.workflow_version, '3.4');
  assert.equal(c.metadata.started_at, '1970-01-01T00:00:00.000Z');
  assert.equal(c.metadata.finished_at, '1970-01-01T00:00:01.000Z');
  assert.equal(c.metadata.utc_offset, '-3600');
  assert.deepEqual(c.metadata.ai_review, { decision: 'reject' });
  assert.equal(c.completed, true);
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
  };
}

test('Auth consumes an implicit-grant redirect and scrubs the URL', () => {
  const storage = memoryStorage();
  const auth = new Auth({ storageKey: 'k', storage });
  const replaced = [];
  const err = auth.consumeRedirect(
    { hash: '#access_token=abc&token_type=Bearer&expires_in=7200', pathname: '/app/', search: '?project=1' },
    { replaceState: (_, __, url) => replaced.push(url) },
  );
  assert.equal(err, null);
  assert.equal(auth.token, 'abc');
  assert.deepEqual(replaced, ['/app/?project=1']);
  assert.equal(new Auth({ storageKey: 'k', storage }).token, 'abc', 'restored from storage');
});

test('Auth reports an error redirect', () => {
  const auth = new Auth({ storageKey: 'k', storage: memoryStorage() });
  const err = auth.consumeRedirect(
    { hash: '#error=access_denied&error_description=Nope', pathname: '/', search: '' },
    { replaceState() {} },
  );
  assert.equal(err, 'Nope');
  assert.equal(auth.token, null);
});

test('PanoptesClient sends the bearer token and surfaces API errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({ errors: [{ message: 'bad link' }] }) };
  };
  const client = new PanoptesClient({ environment: 'staging', getToken: () => 'tok', fetchImpl });
  await assert.rejects(client.createClassification({}), { message: 'bad link', status: 422 });
  assert.equal(calls[0].url, 'https://panoptes-staging.zooniverse.org/api/classifications');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.match(client.authorizeUrl({ clientId: 'c', redirectUri: 'https://me/' }), /response_type=token/);
});

const answerAll = (survey, value) => Object.fromEntries(survey.items.map(i => [i.id, value]));

test('skepticism score flips the reverse-keyed trust items', () => {
  // Fully skeptical: strongly agree with distrust, strongly disagree with trust.
  const responses = Object.fromEntries(SKEPTICISM_SURVEY.items.map(i => [i.id, i.reverse ? 1 : 7]));
  assert.deepEqual(scoreSurvey(SKEPTICISM_SURVEY, responses), { skepticism: 7 });
  assert.deepEqual(scoreSurvey(SKEPTICISM_SURVEY, answerAll(SKEPTICISM_SURVEY, 4)), { skepticism: 4 });
});

test('needs check-in scores each item as its own need', () => {
  assert.deepEqual(NEEDS_SURVEY.items.map(i => i.subscale), ['autonomy', 'competence', 'relatedness']);
  assert.equal(Object.keys(NEEDS_SURVEY.scale.anchors).length, 7);
  assert.deepEqual(scoreSurvey(NEEDS_SURVEY, { autonomy: 6, competence: 3, relatedness: 1 }),
    { autonomy: 6, competence: 3, relatedness: 1 });
});

test('incomplete or out-of-range answers are rejected', () => {
  const partial = answerAll(NEEDS_SURVEY, 4);
  delete partial.relatedness;
  assert.equal(isComplete(NEEDS_SURVEY, partial), false);
  assert.throws(() => scoreSurvey(NEEDS_SURVEY, partial), /relatedness/);
  assert.throws(() => scoreSurvey(NEEDS_SURVEY, { ...answerAll(NEEDS_SURVEY, 4), autonomy: 9 }), /autonomy/);
});

test('participant persists and schedules the check-in every Nth classification', () => {
  const storage = memoryStorage();
  const p = new Participant({ storageKey: 'p', storage });
  assert.ok(p.id);
  const due = [];
  for (let n = 1; n <= 10; n += 1) {
    due.push(p.checkInDueOnNext(5));
    p.recordClassification({ withCheckIn: p.checkInDueOnNext(5) });
  }
  assert.deepEqual(due, [false, false, false, false, true, false, false, false, false, true]);
  assert.equal(p.data.checkInCount, 2);
  assert.equal(p.checkInDueOnNext(0), false, '0 disables the check-in');

  p.setSkepticism({ scores: { skepticism: 5 } });
  const again = new Participant({ storageKey: 'p', storage });
  assert.equal(again.id, p.id);
  assert.equal(again.classificationCount, 10);
  assert.equal(again.metadata().classification_number, 11);
  assert.deepEqual(again.metadata().skepticism, { scores: { skepticism: 5 } });

  again.reset();
  assert.notEqual(again.id, p.id);
  assert.equal(again.skepticism, null);
});

test('participant works without storage', () => {
  const p = new Participant({ storageKey: 'p', storage: null });
  p.recordClassification();
  assert.equal(p.classificationCount, 1);
});
