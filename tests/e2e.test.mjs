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

test('demo: accept after viewing the explanation', async () => {
  const { page, errors } = await open('?surveys=off');
  assert.equal(await page.isVisible('#demo-banner'), true);
  assert.equal(await page.textContent('#ai-label'), 'Spiral galaxy');
  assert.equal(await page.isVisible('#explanation'), false);
  assert.equal(await page.isVisible('#saliency-image'), false);

  await page.click('#explain-button');
  assert.equal(await page.isVisible('#explanation'), true);
  assert.equal(await page.isVisible('#saliency-image'), true);
  assert.equal(await page.getAttribute('#explain-button', 'aria-expanded'), 'true');
  assert.equal(await page.locator('#probability-bars li').count(), 4);

  await page.uncheck('#heatmap-toggle');
  assert.equal(await page.isVisible('#saliency-image'), false);

  await page.click('#accept-button');
  await page.waitForFunction(() => document.getElementById('subject-id').textContent === 'demo-2');

  const payload = await lastPayload(page);
  assert.deepEqual(payload.annotations, [{ task: 'T0', value: 0 }]);
  assert.deepEqual(payload.links.subjects, ['demo-1']);
  const review = payload.metadata.ai_review;
  assert.equal(review.decision, 'accept');
  assert.equal(review.ai_label, 'spiral');
  assert.equal(review.decision_path, 'after_explanation');
  assert.ok(review.events.some(e => e.type === 'heatmap_toggle' && e.detail === false));
  assert.match(await page.textContent('#stats'), /1 reviewed · 1 accepted · 0 rejected/);

  // The next subject starts with the explanation closed again.
  assert.equal(await page.isVisible('#explanation'), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('demo: keyboard reject without explanation', async () => {
  const { page } = await open('?surveys=off');
  await page.keyboard.press('r');
  await page.waitForFunction(() => document.getElementById('subject-id').textContent === 'demo-2');
  const review = (await lastPayload(page)).metadata.ai_review;
  assert.equal(review.decision, 'reject');
  assert.equal(review.decision_path, 'direct');
  assert.equal((await lastPayload(page)).annotations[0].value, 1);
  await page.close();
});

test("?xai=never hides explanations entirely", async () => {
  const { page } = await open('?xai=never&surveys=off');
  assert.equal(await page.isVisible('#explain-button'), false);
  await page.keyboard.press('e');
  assert.equal(await page.isVisible('#explanation'), false);
  await page.click('#accept-button');
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
        return json(route, { workflows: [{ id: '456', version: '7.2', tasks: { T0: { type: 'single', answers: [{ label: 'Accept' }, { label: 'Reject' }] } } }] });
      }
      if (url.pathname === '/api/subjects/queued') {
        return json(route, { subjects: [
          { id: '900', locations: [{ 'image/jpeg': 'https://cdn.test/a.jpg' }], metadata: { note: 'no prediction' } },
          { id: '901', locations: [{ 'image/jpeg': 'https://cdn.test/b.jpg' }, { 'image/png': 'https://cdn.test/b-heat.png' }],
            metadata: { '#ai_label': 'merger', '#ai_confidence': '66', '#ai_saliency': '1' } },
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
      const name = route.request().url().endsWith('heat.png') ? 'subject-merger-saliency.png' : 'subject-merger.jpg';
      route.fulfill({ body: await readFile(join(ROOT, 'demo', name)) });
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
  assert.equal(await page.textContent('#ai-label'), 'Merging galaxies');
  assert.equal(await page.textContent('#confidence-text'), '66% confident');
  assert.equal(await page.getAttribute('#talk-link', 'href'),
    'https://www.zooniverse.org/projects/someone/galaxies/talk/subjects/901');
  assert.equal(await page.getAttribute('#subject-image', 'src'), 'https://cdn.test/b.jpg');

  await page.click('#explain-button');
  assert.equal(await page.isVisible('#saliency-image'), true);
  assert.equal(await page.isVisible('#part-probabilities'), false, 'only the saliency map was provided');

  await page.click('#reject-button');
  await page.waitForSelector('#state-finished:not([hidden]), #state-review #feedback.success');
  assert.equal(mock.posted.length, 1);
  const c = mock.posted[0];
  assert.deepEqual(c.annotations, [{ task: 'T0', value: 1 }]);
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
  await page.click('#accept-button');
  await page.waitForSelector('#feedback.error');
  assert.match(await page.textContent('#feedback'), /Server unavailable/);
  assert.equal(await page.textContent('#subject-id'), '901');
  assert.equal(await page.isEnabled('#accept-button'), true);
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

async function classifyDirect(page, times) {
  for (let i = 0; i < times; i += 1) {
    const before = await page.evaluate(() => window.__secondLook.participant.classificationCount);
    await page.keyboard.press('a');
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
  await page.keyboard.press('r');
  await page.waitForSelector('form.survey[data-survey="needs"]');
  assert.equal(await page.locator('form.survey[data-survey="needs"] .likert-item').count(), 3);
  assert.equal((await lastPayload(page)).metadata.participant.classification_number, 4);

  await answerSurvey(page, 'needs', 3);
  await page.waitForFunction(() => window.__secondLook.participant.classificationCount === 5);
  const fifth = await lastPayload(page);
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
  await page.click('#accept-button');
  await answerSurvey(page, 'needs', 5);
  await page.waitForSelector('#feedback.error');

  await page.click('#accept-button');
  await page.waitForFunction(() => !window.__secondLook.state.busy);
  assert.equal(await page.isHidden('#state-survey'), true);
  assert.equal(mock.posted.length, 2);
  assert.deepEqual(mock.posted[0].metadata.needs, mock.posted[1].metadata.needs);
  assert.equal(mock.posted[1].metadata.participant.classification_number, 5);
  await page.close();
});
