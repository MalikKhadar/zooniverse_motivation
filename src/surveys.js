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
 * Basic psychological needs check-in, asked every few classifications.
 * Adapted from the single-item measures of autonomy, competence and
 * relatedness, reworded to refer to the classifications the volunteer has just
 * done (past tense, as in the Zooniverse adaptation of the BPNSFS items).
 */
export const NEEDS_SURVEY = {
  id: 'needs',
  version: '1',
  title: 'Quick check-in',
  intro: 'Thinking about the classifications you have just done, how much do you agree or disagree with each statement?',
  stem: 'While classifying…',
  scale: {
    min: 1,
    max: 7,
    anchors: {
      1: 'Very strongly disagree',
      2: 'Strongly disagree',
      3: 'Disagree',
      4: 'Neither disagree nor agree',
      5: 'Agree',
      6: 'Strongly agree',
      7: 'Very strongly agree',
    },
  },
  items: [
    { id: 'autonomy', text: 'I was able to do things that I really wanted and valued.', subscale: 'autonomy' },
    { id: 'competence', text: 'I was able to do things well and achieve my goals.', subscale: 'competence' },
    { id: 'relatedness', text: 'I felt close and connected with other people.', subscale: 'relatedness' },
  ],
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
