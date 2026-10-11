/**
 * Reads a model's prediction and explanation out of Panoptes subject metadata.
 *
 * Subject manifests are CSV, so every metadata value arrives as a string;
 * structured fields are JSON-encoded strings. Values that are already objects
 * (e.g. the demo subjects) are accepted as-is. Malformed optional fields are
 * dropped rather than failing the subject.
 */

function parseJsonField(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value.trim().replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}

/** Accepts 0–1 or 0–100 (with or without '%'), returns 0–1. */
export function parseConfidence(value) {
  const n = toNumber(value);
  if (n === null || n < 0) return null;
  const fraction = n > 1 ? n / 100 : n;
  return fraction <= 1 ? fraction : null;
}

/** Only http(s) and relative URLs may reach an <img src>. */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return null;
  return url;
}

export function imageLocations(subject) {
  const urls = [];
  for (const location of subject?.locations || []) {
    for (const [mime, url] of Object.entries(location)) {
      if (mime.startsWith('image/')) urls.push(url);
    }
  }
  return urls;
}

/**
 * The saliency map can be a URL, or an index into the subject's locations
 * ("1" or "location:1") so the heatmap is hosted by Zooniverse with the image.
 */
function resolveSaliency(value, subject) {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).trim().match(/^(?:location:)?(\d+)$/);
  if (match) {
    const index = Number(match[1]);
    const location = subject?.locations?.[index];
    if (!location) return null;
    const entry = Object.entries(location).find(([mime]) => mime.startsWith('image/'));
    return entry ? entry[1] : null;
  }
  return safeUrl(String(value));
}

export function displayLabel(label, labelNames = {}) {
  return labelNames[label] || String(label);
}

function parseProbabilities(value, labelNames) {
  const raw = parseJsonField(value);
  if (!raw || typeof raw !== 'object') return [];
  const pairs = Array.isArray(raw)
    ? raw.map(item => [item?.label, item?.value ?? item?.probability])
    : Object.entries(raw);
  return pairs
    .map(([label, p]) => ({ label: String(label), value: parseConfidence(p) }))
    .filter(item => item.label && item.label !== 'undefined' && item.value !== null)
    .map(item => ({ ...item, displayLabel: displayLabel(item.label, labelNames) }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Training galaxies the model finds most similar to this subject, each tagged
 * with its class. Untagged examples count as the AI's own class.
 */
function parseExamples(value, labelNames, predictedLabel) {
  const raw = parseJsonField(value);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => (typeof item === 'string' ? { url: item } : item || {}))
    .map(item => ({
      url: safeUrl(item.url),
      label: item.label ? String(item.label) : predictedLabel,
      caption: item.caption ? String(item.caption) : null,
    }))
    .filter(item => item.url)
    .map(item => ({ ...item, displayLabel: displayLabel(item.label, labelNames) }));
}

/**
 * Returns null when the subject carries no AI label: such subjects cannot be
 * reviewed and are skipped by the queue.
 */
export function parsePrediction(subject, keys, labelNames = {}) {
  const metadata = subject?.metadata || {};
  const label = metadata[keys.label];
  if (label === undefined || label === null || String(label).trim() === '') return null;

  const prediction = {
    label: String(label).trim(),
    displayLabel: displayLabel(String(label).trim(), labelNames),
    confidence: parseConfidence(metadata[keys.confidence]),
    probabilities: parseProbabilities(metadata[keys.probabilities], labelNames),
    saliencyUrl: resolveSaliency(metadata[keys.saliency], subject),
    examples: parseExamples(metadata[keys.examples], labelNames, String(label).trim()),
    model: metadata[keys.model] ? String(metadata[keys.model]) : null,
  };

  if (prediction.confidence === null) {
    const own = prediction.probabilities.find(p => p.label === prediction.label);
    if (own) prediction.confidence = own.value;
  }

  prediction.examplesByLabel = {};
  for (const example of prediction.examples) {
    (prediction.examplesByLabel[example.label] ||= []).push(example);
  }

  prediction.explanationParts = [
    prediction.saliencyUrl && 'saliency',
    prediction.probabilities.length > 0 && 'probabilities',
    prediction.examples.length > 0 && 'examples',
  ].filter(Boolean);

  return prediction;
}

/**
 * The image the volunteer classifies. When the saliency map is stored as one
 * of the subject's own locations, that location is not the subject image.
 */
export function subjectImage(subject, prediction) {
  const urls = imageLocations(subject);
  return urls.find(url => url !== prediction?.saliencyUrl) || urls[0] || null;
}
