/**
 * Explanation-literacy questions asked at each check-in. Each type tests one
 * kind of explanation. In each, the participant sees a galaxy and four
 * versions of one explanation: the AI's real one for that galaxy and three
 * taken from other galaxies. They pick the real one.
 *
 * Heat map: four heat maps, which they can lay over the galaxy.
 * Probabilities: four class-confidence breakdowns, each with a different top
 * class, so the real one is the only option whose top class is the AI's
 * answer for this galaxy.
 *
 * Pool entries are { id, imageUrl, saliencyUrl, probabilities }.
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
function pickTarget(candidates, pool, usable, random) {
  const fresh = candidates.filter(usable);
  const all = pool.filter(usable);
  const from = fresh.length ? fresh : all;
  return from.length ? from[Math.floor(random() * from.length)] : null;
}

export function buildHeatmapQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.saliencyUrl && !excludeIds.includes(item.id);
  const all = pool.filter(usable);
  const target = pickTarget(candidates, pool, usable, random);
  if (!target) return null;

  // Distinct heat maps only, so no two options are the same picture.
  const seenUrls = new Set([target.saliencyUrl]);
  const distractors = [];
  for (const item of shuffle(all, random)) {
    if (distractors.length === OPTION_COUNT - 1) break;
    if (item.id === target.id || seenUrls.has(item.saliencyUrl)) continue;
    seenUrls.add(item.saliencyUrl);
    distractors.push(item);
  }
  if (distractors.length < OPTION_COUNT - 1) return null;

  const options = shuffle([target, ...distractors], random)
    .map(item => ({ subjectId: item.id, saliencyUrl: item.saliencyUrl }));
  return {
    type: 'heatmap',
    subjectId: target.id,
    imageUrl: target.imageUrl,
    options,
    correctIndex: options.findIndex(option => option.subjectId === target.id),
  };
}

// Breakdowns are sorted highest first, so the first entry is the top class.
const topClass = item => item.probabilities[0].label;

/**
 * Builds one class-confidence question, or returns null when there aren't
 * enough galaxies to give all four options different top classes.
 */
export function buildProbabilityQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.probabilities?.length && !excludeIds.includes(item.id);
  const target = pickTarget(candidates, pool, usable, random);
  if (!target) return null;

  // No two options share a top class.
  const usedTops = new Set([topClass(target)]);
  const distractors = [];
  for (const item of shuffle(pool.filter(usable), random)) {
    if (distractors.length === OPTION_COUNT - 1) break;
    if (item.id === target.id || usedTops.has(topClass(item))) continue;
    usedTops.add(topClass(item));
    distractors.push(item);
  }
  if (distractors.length < OPTION_COUNT - 1) return null;

  const options = shuffle([target, ...distractors], random)
    .map(item => ({ subjectId: item.id, label: topClass(item), probabilities: item.probabilities }));
  return {
    type: 'probabilities',
    subjectId: target.id,
    imageUrl: target.imageUrl,
    options,
    correctIndex: options.findIndex(option => option.subjectId === target.id),
  };
}

/** The record stored with the classification. */
export function scoreQuestion(question, chosenIndex, {
  startedAt, completedAt, changes, events = [], finalOpacity = null,
}) {
  return {
    type: question.type,
    subject_id: question.subjectId,
    option_subject_ids: question.options.map(option => option.subjectId),
    ...(question.type === 'probabilities'
      ? { option_ai_labels: question.options.map(option => option.label) } : {}),
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
