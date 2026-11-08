/**
 * Explanation-literacy questions asked at each check-in. Each type tests one
 * kind of explanation; only heat maps exist so far.
 *
 * Heat map: show a galaxy and four heat maps, one of which is the AI's real
 * map for that galaxy and three of which belong to other galaxies. The
 * participant picks the real one, without being able to overlay any of them.
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
export function buildHeatmapQuestion({ candidates, pool, excludeIds = [], random = Math.random }) {
  const usable = item => item?.imageUrl && item?.saliencyUrl && !excludeIds.includes(item.id);
  const fresh = candidates.filter(usable);
  const all = pool.filter(usable);
  const target = fresh.length ? fresh[Math.floor(random() * fresh.length)]
    : all.length ? all[Math.floor(random() * all.length)] : null;
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

/** The record stored with the classification. */
export function scoreQuestion(question, chosenIndex, {
  startedAt, completedAt, changes, events = [], finalOpacity = null,
}) {
  return {
    type: question.type,
    subject_id: question.subjectId,
    option_subject_ids: question.options.map(option => option.subjectId),
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
