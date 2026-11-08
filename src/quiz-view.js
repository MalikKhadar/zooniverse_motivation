import { scoreQuestion } from './quiz.js';

const LETTERS = 'ABCD';

const DEFAULT_OPACITY = 0.6;
const MAX_EVENTS = 50;

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
 * Renders a heat map question into `container` and resolves with the scored
 * answer once the participant picks an option and continues. Every option is
 * shown laid over the galaxy, and the selected one also over the large view;
 * one slider sets the overlays' opacity. No feedback on whether the answer
 * was right.
 */
export function runHeatmapQuestion(container, question, { clock = () => Date.now() } = {}) {
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
  heading.textContent = 'Spot the real heat map';
  heading.tabIndex = -1;
  const intro = document.createElement('p');
  intro.className = 'survey-intro';
  intro.textContent = 'One of these heat maps shows where the AI looked when it classified this galaxy. ' +
    'The other three belong to other galaxies. Which one is real? Use the slider to see each map more or less strongly.';
  form.append(heading, intro);

  const layout = document.createElement('div');
  layout.className = 'quiz-layout';

  const galaxy = document.createElement('figure');
  galaxy.className = 'quiz-galaxy';
  const large = overlaid(question.imageUrl, null, 'The galaxy');
  const caption = document.createElement('figcaption');
  caption.textContent = 'The galaxy';
  const slider = document.createElement('label');
  slider.className = 'slider quiz-opacity';
  const sliderInput = document.createElement('input');
  sliderInput.type = 'range';
  sliderInput.min = '0';
  sliderInput.max = '1';
  sliderInput.step = '0.05';
  sliderInput.value = String(DEFAULT_OPACITY);
  slider.append('Heat map opacity', sliderInput);
  galaxy.append(large.frame, caption, slider);
  form.style.setProperty('--quiz-opacity', String(DEFAULT_OPACITY));

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'quiz-options';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = 'Heat map options';
  fieldset.append(legend);
  question.options.forEach((option, index) => {
    const label = document.createElement('label');
    label.className = 'quiz-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'heatmap';
    input.value = String(index);
    input.setAttribute('aria-label', `Heat map ${LETTERS[index]}`);
    const { frame } = overlaid(question.imageUrl, option.saliencyUrl, '');
    const letter = document.createElement('span');
    letter.className = 'quiz-letter';
    letter.textContent = LETTERS[index];
    label.append(input, frame, letter);
    fieldset.append(label);
  });

  layout.append(galaxy, fieldset);
  form.append(layout);

  const footer = document.createElement('div');
  footer.className = 'survey-footer';
  const progress = document.createElement('span');
  progress.className = 'survey-progress';
  progress.textContent = 'Pick one heat map';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-button';
  submit.textContent = 'Continue';
  submit.disabled = true;
  footer.append(progress, submit);
  form.append(footer);

  sliderInput.addEventListener('input', () => {
    form.style.setProperty('--quiz-opacity', sliderInput.value);
  });

  form.addEventListener('change', (event) => {
    if (event.target === sliderInput) {
      record('opacity', Number(sliderInput.value));
      return;
    }
    if (event.target.name !== 'heatmap') return;
    const value = Number(event.target.value);
    if (chosen !== null && value !== chosen) changes += 1;
    chosen = value;
    record('select', value);
    large.heat.src = question.options[value].saliencyUrl;
    large.heat.hidden = false;
    caption.textContent = `The galaxy with heat map ${LETTERS[value]}`;
    progress.textContent = `Heat map ${LETTERS[value]} selected`;
    submit.disabled = false;
  });

  container.replaceChildren(form);
  heading.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (chosen === null) return;
      resolve(scoreQuestion(question, chosen, {
        startedAt, completedAt: clock(), changes, events, finalOpacity: Number(sliderInput.value),
      }));
    });
  });
}
