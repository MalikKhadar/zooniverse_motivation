import { isComplete, scoreSurvey } from './surveys.js';

/**
 * Renders a Likert questionnaire into `container` and resolves with the
 * answers once every item is answered and the form is submitted.
 */
export function runSurvey(container, survey, { clock = () => Date.now() } = {}) {
  const startedAt = clock();
  const { min, max, anchors } = survey.scale;
  const responses = {};

  const form = document.createElement('form');
  form.className = 'survey';
  form.dataset.survey = survey.id;
  form.noValidate = true;

  const heading = document.createElement('h2');
  heading.textContent = survey.title;
  heading.tabIndex = -1;
  const intro = document.createElement('p');
  intro.className = 'survey-intro';
  intro.textContent = survey.intro;
  form.append(heading, intro);

  // When every point has a label, show them once as a key.
  const labelled = Object.keys(anchors).length;
  if (labelled === max - min + 1) {
    const key = document.createElement('ol');
    key.className = 'survey-key';
    for (let v = min; v <= max; v += 1) {
      const li = document.createElement('li');
      const number = document.createElement('strong');
      number.textContent = String(v);
      li.append(number, ` ${anchors[v]}`);
      key.append(li);
    }
    form.append(key);
  }

  const stem = document.createElement('p');
  stem.className = 'survey-stem';
  stem.textContent = survey.stem;
  form.append(stem);

  survey.items.forEach((item, index) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'likert-item';
    const legend = document.createElement('legend');
    legend.textContent = `${index + 1}. ${item.text}`;
    fieldset.append(legend);

    const options = document.createElement('div');
    options.className = 'likert-options';
    for (let v = min; v <= max; v += 1) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = item.id;
      input.value = String(v);
      input.setAttribute('aria-label', anchors[v] ? `${v}, ${anchors[v]}` : String(v));
      const number = document.createElement('span');
      number.textContent = String(v);
      label.append(input, number);
      options.append(label);
    }
    fieldset.append(options);

    const ends = document.createElement('div');
    ends.className = 'likert-ends';
    ends.setAttribute('aria-hidden', 'true');
    const low = document.createElement('span');
    low.textContent = anchors[min] || '';
    const high = document.createElement('span');
    high.textContent = anchors[max] || '';
    ends.append(low, high);
    fieldset.append(ends);

    form.append(fieldset);
  });

  const footer = document.createElement('div');
  footer.className = 'survey-footer';
  const progress = document.createElement('span');
  progress.className = 'survey-progress';
  progress.setAttribute('aria-live', 'polite');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-button';
  submit.textContent = 'Continue';
  footer.append(progress, submit);
  form.append(footer);

  const update = () => {
    const answered = Object.keys(responses).length;
    progress.textContent = `${answered} of ${survey.items.length} answered`;
    submit.disabled = !isComplete(survey, responses);
  };

  form.addEventListener('change', (event) => {
    if (event.target.type !== 'radio') return;
    responses[event.target.name] = Number(event.target.value);
    update();
  });

  update();
  container.replaceChildren(form);
  heading.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!isComplete(survey, responses)) return;
      const completedAt = clock();
      resolve({
        survey: survey.id,
        version: survey.version,
        responses: { ...responses },
        scores: scoreSurvey(survey, responses),
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date(completedAt).toISOString(),
        duration_ms: completedAt - startedAt,
      });
    });
  });
}
