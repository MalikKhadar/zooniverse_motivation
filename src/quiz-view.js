import { scoreQuestion } from './quiz.js';

const LETTERS = 'ABCD';

/**
 * Renders a heat map question into `container` and resolves with the scored
 * answer once the participant picks an option and continues. No feedback on
 * whether the answer was right.
 */
export function runHeatmapQuestion(container, question, { clock = () => Date.now() } = {}) {
  const startedAt = clock();
  let chosen = null;
  let changes = 0;

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
    'The other three belong to other galaxies. Which one is real?';
  form.append(heading, intro);

  const layout = document.createElement('div');
  layout.className = 'quiz-layout';

  const galaxy = document.createElement('figure');
  galaxy.className = 'quiz-galaxy';
  const image = document.createElement('img');
  image.src = question.imageUrl;
  image.alt = 'The galaxy';
  const caption = document.createElement('figcaption');
  caption.textContent = 'The galaxy';
  galaxy.append(image, caption);

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
    const map = document.createElement('img');
    map.src = option.saliencyUrl;
    map.alt = '';
    const letter = document.createElement('span');
    letter.className = 'quiz-letter';
    letter.textContent = LETTERS[index];
    label.append(input, map, letter);
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

  form.addEventListener('change', (event) => {
    if (event.target.name !== 'heatmap') return;
    const value = Number(event.target.value);
    if (chosen !== null && value !== chosen) changes += 1;
    chosen = value;
    progress.textContent = `Heat map ${LETTERS[value]} selected`;
    submit.disabled = false;
  });

  container.replaceChildren(form);
  heading.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (chosen === null) return;
      resolve(scoreQuestion(question, chosen, { startedAt, completedAt: clock(), changes }));
    });
  });
}
