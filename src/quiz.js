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
 * Counterfactual: four sets of training galaxies, all from the same class
 * that the AI did not pick (its runner-up where possible): the ones it found
 * most similar to this galaxy, and the ones it found most similar to three
 * other galaxies. Telling them apart takes judging resemblance, not class.
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

const setKey = urls => [...urls].sort().join('|');

/**
 * Builds one counterfactual question, or returns null when no class other
 * than the AI's has four different example sets to choose from.
 */
export function buildCounterfactualQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.probabilities?.length && item?.examples && !excludeIds.includes(item.id);
  const fresh = shuffle(candidates.filter(usable), random);
  const targets = fresh.length ? fresh : shuffle(pool.filter(usable), random);

  for (const target of targets) {
    // Classes the AI didn't pick, most likely first: the runner-up is the
    // natural "why not?" question.
    const contrasts = target.probabilities.slice(1).map(p => p.label)
      .filter(label => target.examples[label]?.length);
    for (const contrast of contrasts) {
      const real = target.examples[contrast];
      const chosen = [real];
      const keys = new Set([setKey(real)]);
      // Other galaxies' sets for the same class: different from every option
      // so far, never containing this galaxy's own image, least overlap first.
      let others = shuffle(pool.filter(usable), random)
        .filter(item => item.id !== target.id && item.examples[contrast]?.length)
        .map(item => ({ item, urls: item.examples[contrast] }))
        .filter(({ urls }) => !urls.includes(target.imageUrl));
      const decoys = [];
      while (decoys.length < OPTION_COUNT - 1 && others.length) {
        const overlap = urls => chosen.reduce((n, set) => n + urls.filter(u => set.includes(u)).length, 0);
        others = others.filter(({ urls }) => !keys.has(setKey(urls)));
        if (!others.length) break;
        const best = others.reduce((a, b) => (overlap(b.urls) < overlap(a.urls) ? b : a));
        decoys.push(best);
        chosen.push(best.urls);
        keys.add(setKey(best.urls));
      }
      if (decoys.length < OPTION_COUNT - 1) continue;

      const options = shuffle([{ item: target, urls: real }, ...decoys], random)
        .map(({ item, urls }) => ({ subjectId: item.id, urls }));
      return {
        type: 'counterfactual',
        subjectId: target.id,
        imageUrl: target.imageUrl,
        contrastLabel: contrast,
        options,
        correctIndex: options.findIndex(option => option.subjectId === target.id),
      };
    }
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
    ...(question.type === 'counterfactual' ? { contrast_label: question.contrastLabel } : {}),
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
