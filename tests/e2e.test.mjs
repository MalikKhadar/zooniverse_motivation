/**
 * Browser tests against a throwaway static server. Panoptes is intercepted,
 * so nothing here talks to the live API.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEMO_SUBJECTS } from '../src/demo-data.js';
import { LABEL_NAMES, CLASS_LABELS } from '../src/config.js';

const [FIRST, SECOND] = DEMO_SUBJECTS;
const FIRST_LABEL = FIRST.metadata['#ai_label'];
// A class other than the AI's, for disagreeing with it.
const OTHER_LABEL = CLASS_LABELS.find(label => label !== FIRST_LABEL);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png',
};

let server, browser, baseUrl;

before(async () => {
  server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  // CHROMIUM_PATH lets you reuse a preinstalled Chromium instead of `npx playwright install`.
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

after(async () => {
  await browser?.close();
  await new Promise(r => server?.close(r));
});

async function open(query = '', setup, { waitFor = '#state-review:not([hidden]), #state-error:not([hidden])' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (setup) await setup(page);
  await page.goto(baseUrl + query);
  await page.waitForSelector(waitFor);
  return { page, errors };
}

const lastPayload = async page => JSON.parse(await page.textContent('#payload-json'));

test('demo: agree with the AI after viewing the explanation', async () => {
  const { page, errors } = await open('?surveys=off');
  assert.equal(await page.isVisible('#demo-banner'), true);
  assert.equal(await page.textContent('#ai-label'), LABEL_NAMES[FIRST_LABEL]);
  assert.equal(await page.locator('#class-options .class-option').count(), CLASS_LABELS.length);
  // The AI's class is outlined as the AI's pick and preselected.
  assert.deepEqual(await page.$$eval('#class-options .is-ai', els => els.map(e => e.dataset.label)), [FIRST_LABEL]);
  assert.deepEqual(await page.$$eval('#class-options .is-selected', els => els.map(e => e.dataset.label)), [FIRST_LABEL]);
  assert.match(await page.textContent('#submit-button'), /Agree with the AI/);
  assert.equal(await page.isVisible('#explanation'), false);
  assert.equal(await page.isVisible('#saliency-image'), false);

  await page.click('#explain-button');
  assert.equal(await page.isVisible('#explanation'), true);
  assert.equal(await page.isVisible('#saliency-image'), true);
  assert.equal(await page.getAttribute('#explain-button', 'aria-expanded'), 'true');
  assert.equal(await page.locator('#class-scores .class-score').count(), Object.keys(JSON.parse(FIRST.metadata['#ai_probabilities'])).length);
  // Examples stay hidden until a class is opened.
  assert.equal(await page.locator('.neighbours:visible').count(), 0);

  // The AI's class shows factual examples; another class shows counterfactuals.
  const aiRow = `.class-score[data-label="${FIRST_LABEL}"] .score-row`;
  const otherRow = `.class-score[data-label="${OTHER_LABEL}"] .score-row`;
  await page.click(aiRow);
  assert.match(await page.textContent(`#neighbours-${FIRST_LABEL}`), new RegExp(`Why ${LABEL_NAMES[FIRST_LABEL]}\\?`));
  await page.click(otherRow);
  assert.equal(await page.isHidden(`#neighbours-${FIRST_LABEL}`), true, 'one class open at a time');
  assert.match(await page.textContent(`#neighbours-${OTHER_LABEL}`), new RegExp(`Why not ${LABEL_NAMES[OTHER_LABEL]}\\?`));
  assert.equal(await page.getAttribute(otherRow, 'aria-expanded'), 'true');
  assert.ok(await page.locator(`#neighbours-${OTHER_LABEL} img`).count() > 0);

  await page.uncheck('#heatmap-toggle');
  assert.equal(await page.isVisible('#saliency-image'), false);

  await page.click('#submit-button');
  await page.waitForFunction(id => document.getElementById('subject-id').textContent === id, SECOND.id);

  const payload = await lastPayload(page);
  assert.deepEqual(payload.annotations, [{ task: 'T0', value: CLASS_LABELS.indexOf(FIRST_LABEL) }]);
  assert.deepEqual(payload.links.subjects, [FIRST.id]);
  const review = payload.metadata.ai_review;
  assert.equal(review.decision, 'accept');
  assert.equal(review.ai_label, FIRST_LABEL);
  assert.equal(review.chosen_label, FIRST_LABEL);
  assert.equal(review.selection_changes, 0);
  assert.equal(review.decision_path, 'after_explanation');
  assert.ok(review.events.some(e => e.type === 'heatmap_toggle' && e.detail === false));
  assert.deepEqual(review.examples_viewed, [FIRST_LABEL, OTHER_LABEL]);
  assert.equal(review.counterfactual_viewed, true);
  assert.deepEqual(review.explanation_parts, ['saliency', 'probabilities', 'examples']);
  assert.match(await page.textContent('#stats'), /1 reviewed · 1 accepted · 0 rejected/);

  // The next subject starts with the explanation closed again.
  assert.equal(await page.isVisible('#explanation'), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('demo: picking another class with the keyboard is a rejection', async () => {
  const { page } = await open('?surveys=off');
  const otherKey = String(CLASS_LABELS.indexOf(OTHER_LABEL) + 1);
  await page.keyboard.press(otherKey);
  assert.deepEqual(await page.$$eval('#class-options .is-selected', els => els.map(e => e.dataset.label)), [OTHER_LABEL]);
  assert.match(await page.textContent('#submit-button'), new RegExp(`Disagree: it's ${LABEL_NAMES[OTHER_LABEL]}`));

  // Changing back and forth is recorded; only the final choice counts.
  await page.click(`.class-option[data-label="${FIRST_LABEL}"]`);
  await page.keyboard.press(otherKey);
  await page.keyboard.press('Enter');
  await page.waitForFunction(id => document.getElementById('subject-id').textContent === id, SECOND.id);
  const payload = await lastPayload(page);
  const review = payload.metadata.ai_review;
  assert.equal(review.decision, 'reject');
  assert.equal(review.chosen_label, OTHER_LABEL);
  assert.equal(review.selection_changes, 3);
  assert.equal(review.decision_path, 'direct');
  assert.equal(payload.annotations[0].value, CLASS_LABELS.indexOf(OTHER_LABEL));
  assert.match(await page.textContent('#stats'), /1 reviewed · 0 accepted · 1 rejected/);
  await page.close();
});

test("?xai=never hides explanations entirely", async () => {
  const { page } = await open('?xai=never&surveys=off');
  assert.equal(await page.isVisible('#explain-button'), false);
  await page.keyboard.press('e');
  assert.equal(await page.isVisible('#explanation'), false);
  await page.click('#submit-button');
  await page.waitForSelector('#payload-preview:not([hidden])');
  const review = (await lastPayload(page)).metadata.ai_review;
  assert.equal(review.explanation_mode, 'never');
  assert.equal(review.explanation_available, false);
  await page.close();
});

test("?xai=always opens the explanation up front", async () => {
  const { page } = await open('?xai=always&surveys=off');
  assert.equal(await page.isVisible('#explanation'), true);
  assert.equal(await page.isVisible('#explain-button'), false);
  await page.close();
});

function mockPanoptes({ failClassification = false } = {}) {
  const posted = [];
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

  const setup = async (page) => {
    await page.route('https://panoptes.zooniverse.org/api/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: {
          'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
        } });
      }
      if (url.pathname === '/api/projects/123') {
        return json(route, { projects: [{ id: '123', slug: 'someone/galaxies', display_name: 'Galaxy Check', links: { active_workflows: ['456'] } }] });
      }
      if (url.pathname === '/api/workflows/456') {
        return json(route, { workflows: [{ id: '456', version: '7.2', tasks: { T0: { type: 'single', answers: CLASS_LABELS.map(label => ({ label })) } } }] });
      }
      if (url.pathname === '/api/subjects/queued') {
        return json(route, { subjects: [
          { id: '900', locations: [{ 'image/jpeg': 'https://cdn.test/a.jpg' }], metadata: { note: 'no prediction' } },
          { id: '901', locations: [{ 'image/jpeg': 'https://cdn.test/b.jpg' }, { 'image/png': 'https://cdn.test/b-heat.png' }],
            metadata: { '#ai_label': 'ring', '#ai_confidence': '66', '#ai_saliency': '1' } },
        ] });
      }
      if (url.pathname === '/api/classifications' && req.method() === 'POST') {
        posted.push(JSON.parse(req.postData()).classifications);
        return failClassification
          ? json(route, { errors: [{ message: 'Server unavailable' }] }, 503)
          : json(route, { classifications: [{ id: '1' }] }, 201);
      }
      return json(route, { errors: [{ message: `unmocked ${url.pathname}` }] }, 404);
    });
    await page.route('https://cdn.test/**', async (route) => {
      const name = route.request().url().endsWith('heat.png') ? 'ring1-saliency.png' : 'ring1.jpg';
      route.fulfill({ body: await readFile(join(ROOT, 'demo', 'morphology', name)) });
    });
  };
  return { posted, setup };
}

test('live: skips unlabelled subjects and posts a reject classification', async () => {
  const mock = mockPanoptes();
  const { page, errors } = await open('?project=123&surveys=off', mock.setup);
  assert.equal(await page.isVisible('#demo-banner'), false);
  assert.equal(await page.textContent('#project-name'), 'Galaxy Check');
  assert.equal(await page.textContent('#subject-id'), '901');
  assert.equal(await page.textContent('#ai-label'), 'Ring');
  assert.equal(await page.textContent('#confidence-text'), '66% confident');
  assert.equal(await page.getAttribute('#talk-link', 'href'),
    'https://www.zooniverse.org/projects/someone/galaxies/talk/subjects/901');
  assert.equal(await page.getAttribute('#subject-image', 'src'), 'https://cdn.test/b.jpg');

  await page.click('#explain-button');
  assert.equal(await page.isVisible('#saliency-image'), true);
  assert.equal(await page.isVisible('#part-probabilities'), false, 'only the saliency map was provided');

  assert.equal(await page.isHidden('#warning-banner'), true, 'workflow answers match the classes');
  await page.click('.class-option[data-label="shell"]');
  await page.click('#submit-button');
  await page.waitForSelector('#state-finished:not([hidden]), #state-review #feedback.success');
  assert.equal(mock.posted.length, 1);
  const c = mock.posted[0];
  assert.deepEqual(c.annotations, [{ task: 'T0', value: CLASS_LABELS.indexOf('shell') }]);
  assert.equal(c.metadata.ai_review.decision, 'reject');
  assert.deepEqual(c.links, { project: '123', workflow: '456', subjects: ['901'] });
  assert.equal(c.metadata.workflow_version, '7.2');
  assert.equal(c.metadata.source, 'second-look');
  assert.equal(c.metadata.ai_review.ai_confidence, 0.66);
  assert.equal(await page.isVisible('#payload-preview'), false, 'payload preview is demo/debug only');
  assert.deepEqual(errors, []);
  await page.close();
});

test('live: a failed submission keeps the subject and lets the volunteer retry', async () => {
  const mock = mockPanoptes({ failClassification: true });
  const { page } = await open('?project=123&workflow=456&surveys=off', mock.setup);
  await page.click('#submit-button');
  await page.waitForSelector('#feedback.error');
  assert.match(await page.textContent('#feedback'), /Server unavailable/);
  assert.equal(await page.textContent('#subject-id'), '901');
  assert.equal(await page.isEnabled('#submit-button'), true);
  assert.equal(await page.isEnabled('.class-option[data-label="ring"]'), true);
  await page.close();
});

/** Answers every item with `value` and submits. */
async function answerSurvey(page, id, value) {
  const form = page.locator(`form.survey[data-survey="${id}"]`);
  await form.waitFor();
  const submit = form.locator('button[type=submit]');
  assert.equal(await submit.isDisabled(), true, 'cannot continue before answering');
  for (const fieldset of await form.locator('.likert-item').all()) {
    await fieldset.locator('label').nth(value - 1).click();
    assert.equal(await fieldset.locator(`input[value="${value}"]`).isChecked(), true);
  }
  await submit.click();
}

/** Answers the check-in heat map question, picking the real map or a decoy. */
async function answerHeatmap(page, { pickReal = true } = {}) {
  const form = page.locator('form.quiz[data-quiz="heatmap"]');
  await form.waitFor();
  assert.equal(await page.isHidden('#state-review'), true, 'the classify view (and its overlay) is hidden');
  assert.equal(await form.locator('button[type=submit]').isDisabled(), true, 'cannot continue before choosing');
  const galaxy = await form.locator('.quiz-galaxy .quiz-frame img').first().getAttribute('src');
  assert.equal(await form.locator('.quiz-galaxy .quiz-heat').isHidden(), true, 'no overlay before choosing');
  const realMap = galaxy.replace(/\.jpg$/, '-saliency.png');
  const maps = await form.locator('.quiz-option .quiz-heat').evaluateAll(imgs => imgs.map(i => i.getAttribute('src')));
  // Every option is laid over the same galaxy.
  const backs = await form.locator('.quiz-option .quiz-frame img:first-child').evaluateAll(imgs => imgs.map(i => i.getAttribute('src')));
  assert.deepEqual(backs, [galaxy, galaxy, galaxy, galaxy]);
  assert.equal(maps.length, 4);
  assert.equal(maps.filter(m => m === realMap).length, 1, 'exactly one option is the real map');
  const index = pickReal ? maps.indexOf(realMap) : maps.findIndex(m => m !== realMap);
  await form.locator('.quiz-option').nth(index).click();
  // The chosen map is laid over the large view, and the slider sets every overlay's opacity.
  assert.equal(await form.locator('.quiz-galaxy .quiz-heat').getAttribute('src'), maps[index]);
  await form.locator('.quiz-opacity input').fill('0.25');
  const opacities = await form.locator('.quiz-heat').evaluateAll(imgs => imgs.map(i => getComputedStyle(i).opacity));
  assert.deepEqual(opacities, ['0.25', '0.25', '0.25', '0.25', '0.25']);
  await form.locator('button[type=submit]').click();
  return { galaxy, index };
}

/** Answers the check-in confidence question, picking the real breakdown. */
async function answerProbabilities(page) {
  const form = page.locator('form.quiz[data-quiz="probabilities"]');
  await form.waitFor();
  assert.equal(await form.locator('button[type=submit]').isDisabled(), true, 'cannot continue before choosing');
  const galaxy = await form.locator('.quiz-galaxy img').getAttribute('src');
  const subject = DEMO_SUBJECTS.find(s => s.locations[0]['image/jpeg'] === galaxy);
  const realTop = LABEL_NAMES[subject.metadata['#ai_label']];
  const tops = await form.locator('.quiz-probs li:first-child .quiz-prob-name').allTextContents();
  assert.deepEqual(tops, [realTop, realTop, realTop, realTop], 'every option is topped by the AI\'s class');
  // Find the real one by its whole breakdown.
  const real = Object.entries(JSON.parse(subject.metadata['#ai_probabilities']))
    .sort((a, b) => b[1] - a[1]).map(([label, p]) => `${LABEL_NAMES[label]}${Math.round(p * 100)}%`).join('|');
  const shown = [];
  for (const option of await form.locator('.quiz-option').all()) {
    const rows = await option.locator('.quiz-probs li').evaluateAll(lis => lis.map(li =>
      li.querySelector('.quiz-prob-name').textContent + li.querySelector('.bar-value').textContent));
    shown.push(rows.join('|'));
  }
  assert.equal(new Set(shown).size, 4, 'all four breakdowns differ');
  const index = shown.indexOf(real);
  assert.ok(index >= 0, 'the real breakdown is one of the options');
  await form.locator('.quiz-option').nth(index).click();
  await form.locator('button[type=submit]').click();
  return { subjectId: subject.id, index };
}

/** Answers the check-in counterfactual question, picking the real set. */
async function answerCounterfactual(page) {
  const form = page.locator('form.quiz[data-quiz="counterfactual"]');
  await form.waitFor();
  assert.equal(await form.locator('button[type=submit]').isDisabled(), true, 'cannot continue before choosing');
  const galaxy = await form.locator('.quiz-galaxy img').getAttribute('src');
  const subject = DEMO_SUBJECTS.find(s => s.locations[0]['image/jpeg'] === galaxy);
  const title = await form.locator('h2').textContent();
  const contrast = Object.keys(LABEL_NAMES).find(label => title === `Why not ${LABEL_NAMES[label]}?`);
  assert.ok(contrast, `title names a class: ${title}`);
  assert.notEqual(contrast, subject.metadata['#ai_label'], 'a class the AI did not pick');
  const realSet = JSON.parse(subject.metadata['#ai_examples']).filter(e => e.label === contrast).map(e => e.url);
  const sets = [];
  for (const option of await form.locator('.quiz-option').all()) {
    sets.push(await option.locator('.quiz-examples img').evaluateAll(imgs => imgs.map(i => i.getAttribute('src'))));
  }
  assert.equal(sets.length, 4);
  assert.equal(new Set(sets.map(set => set.join())).size, 4, 'all four sets differ');
  const index = sets.findIndex(set => set.join() === realSet.join());
  assert.ok(index >= 0, 'the real set is one of the options');
  await form.locator('.quiz-option').nth(index).click();
  await form.locator('button[type=submit]').click();
  return { subjectId: subject.id, contrast, index };
}

async function classifyDirect(page, times) {
  for (let i = 0; i < times; i += 1) {
    const before = await page.evaluate(() => window.__secondLook.participant.classificationCount);
    await page.keyboard.press('Enter');
    await page.waitForFunction(n => window.__secondLook.participant.classificationCount > n
      || !document.getElementById('state-survey').hidden, before);
    if (!(await page.isHidden('#state-survey'))) return;
    await page.waitForFunction(() => !window.__secondLook.state.busy);
  }
}

test('surveys: skepticism once on first visit, needs check-in after every 5th classification', async () => {
  const { page, errors } = await open('', null, { waitFor: '#state-survey:not([hidden])' });
  assert.equal(await page.isHidden('#state-review'), true);
  assert.equal(await page.locator('form.survey[data-survey="ai_skepticism"] .likert-item').count(), 6);

  // 6 on every item: skeptical items score 6, reverse-keyed ones flip to 2.
  await answerSurvey(page, 'ai_skepticism', 6);
  await page.waitForSelector('#state-review:not([hidden])');

  await classifyDirect(page, 4);
  assert.equal(await page.isHidden('#state-survey'), true, 'no check-in before the 5th');
  const fourth = await lastPayload(page);
  assert.equal(fourth.metadata.participant.classification_number, 4);
  assert.equal(fourth.metadata.participant.skepticism.scores.skepticism, 4);
  assert.equal(fourth.metadata.needs, undefined);

  // The 5th decision opens the check-in before anything is submitted.
  const ai = await page.evaluate(() => window.__secondLook.state.current.prediction.label);
  await page.keyboard.press(String(CLASS_LABELS.findIndex(label => label !== ai) + 1));
  await page.keyboard.press('Enter');
  await page.waitForSelector('form.survey[data-survey="needs"]');
  assert.equal(await page.locator('form.survey[data-survey="needs"] .likert-item').count(), 3);
  assert.equal((await lastPayload(page)).metadata.participant.classification_number, 4);

  await answerSurvey(page, 'needs', 3);
  const fifthSubject = await page.evaluate(() => window.__secondLook.state.current.subject.id);
  const answered = await answerHeatmap(page);
  const answeredProbs = await answerProbabilities(page);
  const answeredCf = await answerCounterfactual(page);
  await page.waitForFunction(() => window.__secondLook.participant.classificationCount === 5);
  const fifth = await lastPayload(page);
  const quiz = fifth.metadata.xai_quiz.heatmap;
  assert.equal(quiz.correct, true);
  assert.equal(quiz.chosen_index, answered.index);
  assert.equal(quiz.final_opacity, 0.25);
  assert.equal(quiz.opacity_changes, 1);
  assert.deepEqual(quiz.events.map(e => e.type), ['select', 'opacity']);
  const probs = fifth.metadata.xai_quiz.probabilities;
  assert.equal(probs.correct, true);
  assert.equal(probs.subject_id, answeredProbs.subjectId);
  assert.equal(probs.chosen_index, answeredProbs.index);
  assert.notEqual(probs.subject_id, quiz.subject_id, 'the two questions use different galaxies');
  assert.notEqual(probs.subject_id, fifthSubject);
  assert.equal(probs.ai_label, DEMO_SUBJECTS.find(s => s.id === probs.subject_id).metadata['#ai_label']);
  const aiLabelOf = id => DEMO_SUBJECTS.find(s => s.id === id).metadata['#ai_label'];
  assert.ok(probs.option_subject_ids.every(id => aiLabelOf(id) === probs.ai_label), 'confidence options share a class');
  assert.ok(quiz.option_subject_ids.every(id => aiLabelOf(id) === quiz.ai_label), 'heat map options share a class');
  const cf = fifth.metadata.xai_quiz.counterfactual;
  assert.equal(cf.correct, true);
  assert.equal(cf.subject_id, answeredCf.subjectId);
  assert.equal(cf.contrast_label, answeredCf.contrast);
  assert.equal(cf.chosen_index, answeredCf.index);
  assert.equal(new Set([quiz.subject_id, probs.subject_id, cf.subject_id, fifthSubject]).size, 4,
    'each question uses its own galaxy');
  assert.equal(quiz.option_subject_ids.length, 4);
  assert.ok(answered.galaxy.includes(quiz.subject_id.replace('demo-', '')));
  assert.notEqual(quiz.subject_id, fifthSubject, 'not the galaxy just classified');
  assert.equal(await page.evaluate(id => window.__secondLook.state.queue.some(s => s.id === id), quiz.subject_id), false,
    'the quiz galaxy is dropped from the queue');
  assert.equal(fifth.metadata.ai_review.decision, 'reject');
  assert.equal(fifth.metadata.participant.classification_number, 5);
  assert.equal(fifth.metadata.needs.survey, 'needs');
  assert.equal(fifth.metadata.needs.block, 1);
  assert.deepEqual(fifth.metadata.needs.responses, { autonomy: 3, competence: 3, relatedness: 3 });
  assert.deepEqual(fifth.metadata.needs.scores, { autonomy: 3, competence: 3, relatedness: 3 });
  assert.ok(fifth.metadata.participant.id);

  // A returning visitor is not asked again and keeps the same participant ID.
  const id = fifth.metadata.participant.id;
  await page.reload();
  await page.waitForSelector('#state-review:not([hidden])');
  assert.equal(await page.evaluate(() => window.__secondLook.participant.id), id);
  assert.deepEqual(errors, []);
  await page.close();
});

test('surveys: a failed submission after the check-in does not ask it again', async () => {
  const mock = mockPanoptes({ failClassification: true });
  const { page } = await open('?project=123', mock.setup, { waitFor: '#state-survey:not([hidden])' });
  await answerSurvey(page, 'ai_skepticism', 4);
  await page.waitForSelector('#state-review:not([hidden])');

  // Pretend four classifications already happened so the next one is the 5th.
  await page.evaluate(() => { window.__secondLook.participant.data.classificationCount = 4; });
  await page.click('#submit-button');
  await answerSurvey(page, 'needs', 5);
  // The mock queue has too few galaxies with heat maps for a question.
  await page.waitForSelector('#feedback.error');
  assert.deepEqual(mock.posted[0].metadata.xai_quiz, {
    heatmap: { type: 'heatmap', skipped: 'not_enough_heatmaps' },
    probabilities: { type: 'probabilities', skipped: 'not_enough_other_classes' },
    counterfactual: { type: 'counterfactual', skipped: 'not_enough_example_sets' },
  });

  await page.click('#submit-button');
  await page.waitForFunction(() => !window.__secondLook.state.busy);
  assert.equal(await page.isHidden('#state-survey'), true);
  assert.equal(mock.posted.length, 2);
  assert.deepEqual(mock.posted[0].metadata.needs, mock.posted[1].metadata.needs);
  assert.equal(mock.posted[1].metadata.participant.classification_number, 5);
  await page.close();
});
