import { scoreQuestion } from './quiz.js';

const LETTERS = 'ABCD';

const DEFAULT_OPACITY = 0.6;
const MAX_EVENTS = 50;

/**
 * The parts every check-in question shares: heading, the galaxy on the left,
 * four lettered options on the right, and a Continue button that unlocks once
 * an option is picked. Resolves with the scored answer; no feedback on
 * whether it was right.
 *
 * `renderOption(option)` returns the option's content, `galaxy` is the left
 * column, `onSelect(index)` runs when the pick changes, and `extra()` adds to
 * the scored result.
 */
function runQuestion(container, question, {
  title, intro, noun, galaxy, renderOption, onSelect = () => {}, extra = () => ({}),
  clock = () => Date.now(),
}) {
  const startedAt = clock();
  let chosen = null;
  let changes = 0;
  const events = [];
  const record = (type, detail) => {
    if (events.length < MAX_EVENTS) events.push({ type, t_ms: clock() - startedAt, detail });
  };

  const form = document.createElement('form');
  form.className = 'survey quiz';
  form.dataset.quiz = question.type;
  form.noValidate = true;

  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.tabIndex = -1;
  const introText = document.createElement('p');
  introText.className = 'survey-intro';
  introText.textContent = intro;
  form.append(heading, introText);

  const layout = document.createElement('div');
  layout.className = 'quiz-layout';

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'quiz-options';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = `${noun} options`;
  fieldset.append(legend);
  question.options.forEach((option, index) => {
    const label = document.createElement('label');
    label.className = 'quiz-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'quiz-option';
    input.value = String(index);
    input.setAttribute('aria-label', `${noun} ${LETTERS[index]}`);
    const letter = document.createElement('span');
    letter.className = 'quiz-letter';
    letter.textContent = LETTERS[index];
    label.append(input, renderOption(option), letter);
    fieldset.append(label);
  });

  layout.append(galaxy, fieldset);
  form.append(layout);

  const footer = document.createElement('div');
  footer.className = 'survey-footer';
  const progress = document.createElement('span');
  progress.className = 'survey-progress';
  progress.textContent = `Pick one ${noun.toLowerCase()}`;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-button';
  submit.textContent = 'Continue';
  submit.disabled = true;
  footer.append(progress, submit);
  form.append(footer);

  form.addEventListener('change', (event) => {
    if (event.target.name !== 'quiz-option') return;
    const value = Number(event.target.value);
    if (chosen !== null && value !== chosen) changes += 1;
    chosen = value;
    record('select', value);
    onSelect(value);
    progress.textContent = `${noun} ${LETTERS[value]} selected`;
    submit.disabled = false;
  });

  container.replaceChildren(form);
  heading.focus();

  const done = new Promise((resolve) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (chosen === null) return;
      resolve(scoreQuestion(question, chosen, {
        startedAt, completedAt: clock(), changes, events, ...extra(),
      }));
    });
  });
  return { form, record, done };
}

function galaxyFigure() {
  const figure = document.createElement('figure');
  figure.className = 'quiz-galaxy';
  const caption = document.createElement('figcaption');
  caption.textContent = 'The galaxy';
  return { figure, caption };
}

/** The galaxy with a heat map laid over it; the map follows the opacity slider. */
function overlaid(imageUrl, saliencyUrl, alt) {
  const frame = document.createElement('div');
  frame.className = 'quiz-frame';
  const galaxy = document.createElement('img');
  galaxy.src = imageUrl;
  galaxy.alt = alt;
  const heat = document.createElement('img');
  heat.className = 'quiz-heat';
  heat.alt = '';
  if (saliencyUrl) heat.src = saliencyUrl;
  else heat.hidden = true;
  frame.append(galaxy, heat);
  return { frame, heat };
}

/**
 * Heat map question. Every option is shown laid over the galaxy, and the
 * selected one also over the large view; one slider sets the overlays'
 * opacity.
 */
export function runHeatmapQuestion(container, question, { clock } = {}) {
  const { figure, caption } = galaxyFigure();
  const large = overlaid(question.imageUrl, null, 'The galaxy');
  const slider = document.createElement('label');
  slider.className = 'slider quiz-opacity';
  const sliderInput = document.createElement('input');
  sliderInput.type = 'range';
  sliderInput.min = '0';
  sliderInput.max = '1';
  sliderInput.step = '0.05';
  sliderInput.value = String(DEFAULT_OPACITY);
  slider.append('Heat map opacity', sliderInput);
  figure.append(large.frame, caption, slider);

  const { form, record, done } = runQuestion(container, question, {
    clock,
    title: 'Spot the real heat map',
    intro: 'One of these heat maps shows where the AI looked when it classified this galaxy. ' +
      'The other three belong to other galaxies. Which one is real? ' +
      'Use the slider to see each map more or less strongly.',
    noun: 'Heat map',
    galaxy: figure,
    renderOption: option => overlaid(question.imageUrl, option.saliencyUrl, '').frame,
    onSelect: (index) => {
      large.heat.src = question.options[index].saliencyUrl;
      large.heat.hidden = false;
      caption.textContent = `The galaxy with heat map ${LETTERS[index]}`;
    },
    extra: () => ({ finalOpacity: Number(sliderInput.value) }),
  });

  form.style.setProperty('--quiz-opacity', String(DEFAULT_OPACITY));
  sliderInput.addEventListener('input', () => form.style.setProperty('--quiz-opacity', sliderInput.value));
  sliderInput.addEventListener('change', () => record('opacity', Number(sliderInput.value)));
  return done;
}

/** One confidence breakdown, highest class first, as in the explanation panel. */
function breakdown(probabilities, labelNames) {
  const list = document.createElement('ul');
  list.className = 'quiz-probs';
  for (const { label, value } of probabilities) {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'quiz-prob-name';
    name.textContent = labelNames[label] || label;
    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.round(value * 100)}%`;
    track.append(fill);
    const amount = document.createElement('span');
    amount.className = 'bar-value';
    amount.textContent = `${Math.round(value * 100)}%`;
    row.append(name, track, amount);
    list.append(row);
  }
  return list;
}

/** Class-confidence question: four breakdowns, one of them this galaxy's. */
export function runProbabilityQuestion(container, question, { clock, labelNames = {} } = {}) {
  const { figure, caption } = galaxyFigure();
  const frame = document.createElement('div');
  frame.className = 'quiz-frame';
  const image = document.createElement('img');
  image.src = question.imageUrl;
  image.alt = 'The galaxy';
  frame.append(image);
  figure.append(frame, caption);

  return runQuestion(container, question, {
    clock,
    title: 'Spot the real confidence scores',
    intro: "One of these shows how confident the AI was in each class when it classified this galaxy. " +
      'The other three belong to other galaxies. Which one is real?',
    noun: 'Breakdown',
    galaxy: figure,
    renderOption: option => breakdown(option.probabilities, labelNames),
  }).done;
}
