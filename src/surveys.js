/**
 * Questionnaire definitions and scoring.
 *
 * Each survey is a set of Likert items on one shared scale. Items belong to a
 * subscale; a subscale score is the mean of its items after reverse-keyed
 * items are flipped (min + max − response).
 */

const AGREE_7 = {
  min: 1,
  max: 7,
  anchors: {
    1: 'Strongly disagree',
    4: 'Neither agree nor disagree',
    7: 'Strongly agree',
  },
};

/**
 * Attitude towards AI, asked once on a volunteer's first visit. Higher score =
 * more skeptical. Items are adapted from the distrust/trust items of the Trust
 * in Automated Systems scale (Jian, Bisantz & Drury, 2000), reworded to refer
 * to AI in general. Swap in your own validated instrument if you prefer.
 */
export const SKEPTICISM_SURVEY = {
  id: 'ai_skepticism',
  version: '1',
  title: 'Before you start',
  intro: 'A few quick questions about how you feel about artificial intelligence (AI) in general. ' +
    'There are no right or wrong answers.',
  stem: 'How much do you agree with each statement?',
  scale: AGREE_7,
  items: [
    { id: 'suspicious', text: 'I am suspicious of the outputs of AI systems.', subscale: 'skepticism' },
    { id: 'confident', text: 'I am confident in AI systems.', subscale: 'skepticism', reverse: true },
    { id: 'wary', text: 'I am wary of AI systems.', subscale: 'skepticism' },
    { id: 'reliable', text: 'AI systems are reliable.', subscale: 'skepticism', reverse: true },
    { id: 'deceptive', text: 'AI systems can be deceptive.', subscale: 'skepticism' },
    { id: 'trust', text: 'I can trust AI systems.', subscale: 'skepticism', reverse: true },
  ],
};

/**
 * Situational Motivation Scale (SIMS; Guay, Vallerand & Blanchard, 2000).
 * 16 items, four subscales, items in the published order.
 */
export const SIMS_SURVEY = {
  id: 'sims',
  version: '1',
  title: 'Quick check-in',
  intro: 'Please read each item and pick the answer that best describes why you are doing this activity right now.',
  stem: 'Why are you currently engaged in this activity?',
  scale: {
    min: 1,
    max: 7,
    anchors: {
      1: 'Corresponds not at all',
      2: 'Corresponds very little',
      3: 'Corresponds a little',
      4: 'Corresponds moderately',
      5: 'Corresponds enough',
      6: 'Corresponds a lot',
      7: 'Corresponds exactly',
    },
  },
  items: [
    { id: 'q1', text: 'Because I think that this activity is interesting', subscale: 'intrinsic_motivation' },
    { id: 'q2', text: 'Because I am doing it for my own good', subscale: 'identified_regulation' },
    { id: 'q3', text: 'Because I am supposed to do it', subscale: 'external_regulation' },
    { id: 'q4', text: "There may be good reasons to do this activity, but personally I don't see any", subscale: 'amotivation' },
    { id: 'q5', text: 'Because I think that this activity is pleasant', subscale: 'intrinsic_motivation' },
    { id: 'q6', text: 'Because I think that this activity is good for me', subscale: 'identified_regulation' },
    { id: 'q7', text: 'Because it is something that I have to do', subscale: 'external_regulation' },
    { id: 'q8', text: 'I do this activity but I am not sure if it is worth it', subscale: 'amotivation' },
    { id: 'q9', text: 'Because this activity is fun', subscale: 'intrinsic_motivation' },
    { id: 'q10', text: 'By personal decision', subscale: 'identified_regulation' },
    { id: 'q11', text: "Because I don't have any choice", subscale: 'external_regulation' },
    { id: 'q12', text: "I don't know; I don't see what this activity brings me", subscale: 'amotivation' },
    { id: 'q13', text: 'Because I feel good when doing this activity', subscale: 'intrinsic_motivation' },
    { id: 'q14', text: 'Because I believe that this activity is important for me', subscale: 'identified_regulation' },
    { id: 'q15', text: 'Because I feel that I have to do it', subscale: 'external_regulation' },
    { id: 'q16', text: 'I do this activity, but I am not sure it is a good thing to pursue it', subscale: 'amotivation' },
  ],
  // Self-determination index: weights run from autonomous to amotivated.
  derive: s => ({
    self_determination_index: round(
      2 * s.intrinsic_motivation + s.identified_regulation - s.external_regulation - 2 * s.amotivation,
    ),
  }),
};

function round(n) {
  return Math.round(n * 1000) / 1000;
}

export function isComplete(survey, responses) {
  return survey.items.every(item => Number.isInteger(responses[item.id]));
}

export function scoreSurvey(survey, responses) {
  const { min, max } = survey.scale;
  const totals = {};
  for (const item of survey.items) {
    const value = responses[item.id];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Missing or out-of-range answer for ${survey.id}.${item.id}`);
    }
    const keyed = item.reverse ? min + max - value : value;
    (totals[item.subscale] ||= []).push(keyed);
  }
  const scores = {};
  for (const [subscale, values] of Object.entries(totals)) {
    scores[subscale] = round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  return { ...scores, ...(survey.derive ? survey.derive(scores) : {}) };
}
