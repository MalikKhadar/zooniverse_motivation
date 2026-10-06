/**
 * What this browser remembers about the volunteer between visits: an
 * anonymous participant ID (so survey answers and classifications can be
 * linked even when nobody signs in), their questionnaire answers, and how many
 * subjects they have classified. Storage failures (private windows, blocked
 * site data) fall back to memory for the current visit.
 */

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class Participant {
  constructor({ storageKey, storage }) {
    this.storageKey = storageKey;
    this.storage = storage;
    this.data = this.load() || { id: randomId(), skepticism: null, classificationCount: 0, simsCount: 0 };
    this.save();
  }

  load() {
    try {
      const saved = JSON.parse(this.storage?.getItem(this.storageKey) || 'null');
      return saved?.id ? saved : null;
    } catch (_) {
      return null;
    }
  }

  save() {
    try { this.storage?.setItem(this.storageKey, JSON.stringify(this.data)); } catch (_) {}
  }

  reset() {
    try { this.storage?.removeItem(this.storageKey); } catch (_) {}
    this.data = { id: randomId(), skepticism: null, classificationCount: 0, simsCount: 0 };
    this.save();
  }

  get id() { return this.data.id; }
  get skepticism() { return this.data.skepticism; }
  get classificationCount() { return this.data.classificationCount; }

  setSkepticism(result) {
    this.data.skepticism = result;
    this.save();
  }

  recordClassification({ withSims = false } = {}) {
    this.data.classificationCount += 1;
    if (withSims) this.data.simsCount += 1;
    this.save();
  }

  /** True when the classification about to be sent is the nth, 2nth, … one. */
  simsDueOnNext(every) {
    return every > 0 && (this.data.classificationCount + 1) % every === 0;
  }

  /** Attached to every classification so each one can be analysed on its own. */
  metadata() {
    return {
      id: this.data.id,
      classification_number: this.data.classificationCount + 1,
      skepticism: this.data.skepticism,
    };
  }
}
