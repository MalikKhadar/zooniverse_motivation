/**
 * Explanation-literacy questions asked at each check-in. Each type tests one
 * kind of explanation. In each, the participant sees a galaxy and four
 * versions of one explanation: the AI's real one for that galaxy and three
 * taken from other galaxies. They pick the real one.
 *
 * Heat map: four heat maps, which they can lay over the galaxy.
 * Probabilities: four class-confidence breakdowns.
 * For both, all four options come from galaxies the AI put in the same class,
 * so the class alone doesn't give the answer away.
 *
 * Counterfactual: the galaxy's own "Why not …?" sets for four classes the
 * AI didn't pick, each a different class. Told the AI's pick, the participant
 * finds the set for its runner-up class.
 *
 * Pool entries are { id, imageUrl, saliencyUrl, label, probabilities, examples },
 * where examples maps a class to its nearest training images' URLs.
 */

export const OPTION_COUNT = 4;

function shuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Builds one heat map question, or returns null when there aren't enough
 * galaxies with heat maps yet.
 *
 * `candidates` are galaxies the participant hasn't classified (preferred as
 * the target, so they haven't seen its real heat map); `pool` is every known
 * galaxy, used for distractors. Each entry is { id, imageUrl, saliencyUrl }.
 */
// The class the AI put a galaxy in: its label, else the top of its breakdown
// (breakdowns are sorted highest first).
const aiClass = item => item.label ?? item.probabilities?.[0]?.label ?? null;

/**
 * Picks a target galaxy and three decoys the AI put in the same class, all
 * with different explanations (by `key`). Unclassified candidates are tried
 * first, in random order, then any galaxy in the pool. Returns null when no
 * galaxy has three such peers.
 */
function sameClassOptions({ candidates, pool, usable, key, random }) {
  const all = pool.filter(usable);
  const fresh = shuffle(candidates.filter(usable), random);
  const freshIds = new Set(fresh.map(item => item.id));
  const targets = [...fresh, ...shuffle(all.filter(item => !freshIds.has(item.id)), random)];
  for (const target of targets) {
    const seen = new Set([key(target)]);
    const distractors = [];
    for (const item of shuffle(all, random)) {
      if (distractors.length === OPTION_COUNT - 1) break;
      if (item.id === target.id || aiClass(item) !== aiClass(target) || seen.has(key(item))) continue;
      seen.add(key(item));
      distractors.push(item);
    }
    if (distractors.length === OPTION_COUNT - 1) return { target, distractors };
  }
  return null;
}

export function buildHeatmapQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.saliencyUrl && aiClass(item) && !excludeIds.includes(item.id);
  const picked = sameClassOptions({ candidates, pool, usable, key: item => item.saliencyUrl, random });
  if (!picked) return null;
  const { target, distractors } = picked;

  const options = shuffle([target, ...distractors], random)
    .map(item => ({ subjectId: item.id, saliencyUrl: item.saliencyUrl }));
  return {
    type: 'heatmap',
    subjectId: target.id,
    imageUrl: target.imageUrl,
    aiLabel: aiClass(target),
    options,
    correctIndex: options.findIndex(option => option.subjectId === target.id),
  };
}

const breakdownKey = item => item.probabilities.map(p => `${p.label}:${p.value}`).join('|');

/**
 * Builds one class-confidence question, or returns null when no galaxy has
 * three others of its class with different breakdowns.
 */
export function buildProbabilityQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.probabilities?.length && !excludeIds.includes(item.id);
  const picked = sameClassOptions({ candidates, pool, usable, key: breakdownKey, random });
  if (!picked) return null;
  const { target, distractors } = picked;

  const options = shuffle([target, ...distractors], random)
    .map(item => ({ subjectId: item.id, probabilities: item.probabilities }));
  return {
    type: 'probabilities',
    subjectId: target.id,
    imageUrl: target.imageUrl,
    aiLabel: aiClass(target),
    options,
    correctIndex: options.findIndex(option => option.subjectId === target.id),
  };
}

/**
 * Builds one counterfactual question from a single galaxy's explanation: its
 * "Why not …?" sets for four classes the AI didn't pick. The participant is
 * told the AI's pick and asked which set is the one for the runner-up class.
 * Returns null when no galaxy has example sets for four such classes.
 */
export function buildCounterfactualQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.probabilities?.length && item?.examples && !excludeIds.includes(item.id);
  const fresh = shuffle(candidates.filter(usable), random);
  const freshIds = new Set(fresh.map(item => item.id));
  const targets = [...fresh, ...shuffle(pool.filter(item => usable(item) && !freshIds.has(item.id)), random)];

  for (const target of targets) {
    const picked = aiClass(target);
    // Classes the AI didn't pick, most likely first, that have examples.
    const others = target.probabilities.map(p => p.label)
      .filter(label => label !== picked && target.examples[label]?.length);
    if (others.length < OPTION_COUNT) continue;
    const [contrast, ...rest] = others;
    // Same number of images in every set, so set size isn't a giveaway.
    const size = target.examples[contrast].length;
    const sameSize = rest.filter(label => target.examples[label].length === size);
    if (sameSize.length < OPTION_COUNT - 1) continue;
    const labels = [contrast, ...shuffle(sameSize, random).slice(0, OPTION_COUNT - 1)];
    const options = shuffle(labels, random)
      .map(label => ({ subjectId: target.id, label, urls: target.examples[label] }));
    return {
      type: 'counterfactual',
      subjectId: target.id,
      imageUrl: target.imageUrl,
      aiLabel: picked,
      contrastLabel: contrast,
      options,
      correctIndex: options.findIndex(option => option.label === contrast),
    };
  }
  return null;
}

/** The record stored with the classification. */
export function scoreQuestion(question, chosenIndex, {
  startedAt, completedAt, changes, events = [], finalOpacity = null,
}) {
  return {
    type: question.type,
    subject_id: question.subjectId,
    option_subject_ids: question.options.map(option => option.subjectId),
    ...(question.aiLabel ? { ai_label: question.aiLabel } : {}),
    ...(question.type === 'counterfactual' ? {
      contrast_label: question.contrastLabel,
      option_labels: question.options.map(option => option.label),
    } : {}),
    correct_index: question.correctIndex,
    chosen_index: chosenIndex,
    correct: chosenIndex === question.correctIndex,
    answer_changes: changes,
    final_opacity: finalOpacity,
    opacity_changes: events.filter(e => e.type === 'opacity').length,
    events,
    started_at: new Date(startedAt).toISOString(),
    completed_at: new Date(completedAt).toISOString(),
    duration_ms: completedAt - startedAt,
  };
}
