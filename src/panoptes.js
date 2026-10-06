/**
 * Minimal Panoptes API client and OAuth (implicit grant) sign-in.
 *
 * Implicit grant returns the token in the URL fragment, so a static page never
 * has to POST /oauth/token, which Panoptes does not CORS-permit from arbitrary
 * origins such as GitHub Pages.
 */

const ORIGINS = {
  production: 'https://panoptes.zooniverse.org',
  staging: 'https://panoptes-staging.zooniverse.org',
};

const ACCEPT = 'application/vnd.api+json; version=1';

export class PanoptesError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function errorFrom(response) {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const body = await response.json();
    message = body?.errors?.[0]?.message || message;
  } catch (_) {}
  return new PanoptesError(response.status, message);
}

export class PanoptesClient {
  constructor({ environment = 'production', getToken = () => null, fetchImpl } = {}) {
    this.origin = ORIGINS[environment] || ORIGINS.production;
    this.getToken = getToken;
    this.fetch = fetchImpl || ((...args) => window.fetch(...args));
  }

  get apiBase() {
    return `${this.origin}/api`;
  }

  headers(extra = {}) {
    const token = this.getToken();
    return {
      Accept: ACCEPT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async get(path, params = {}) {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    const response = await this.fetch(url.toString(), { headers: this.headers() });
    if (!response.ok) throw await errorFrom(response);
    return response.json();
  }

  async getProject(id) {
    return (await this.get(`/projects/${id}`)).projects[0];
  }

  async getWorkflow(id) {
    return (await this.get(`/workflows/${id}`)).workflows[0];
  }

  async getQueuedSubjects(workflowId, pageSize) {
    const data = await this.get('/subjects/queued', { workflow_id: workflowId, page_size: pageSize });
    return data.subjects || [];
  }

  async getMe() {
    return (await this.get('/me')).users?.[0] || null;
  }

  async createClassification(classification) {
    const response = await this.fetch(`${this.apiBase}/classifications`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ classifications: classification }),
    });
    if (!response.ok) throw await errorFrom(response);
    return response.json();
  }

  authorizeUrl({ clientId, redirectUri, scope = 'public classification' }) {
    const url = new URL(`${this.origin}/oauth/authorize`);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scope);
    return url.toString();
  }
}

/** Token storage scoped to the browser tab. */
export class Auth {
  constructor({ storageKey, storage = window.sessionStorage }) {
    this.storageKey = storageKey;
    this.storage = storage;
    this.token = null;
    this.expiresAt = 0;
    this.login = null;
    this.restore();
  }

  restore() {
    try {
      const saved = JSON.parse(this.storage.getItem(this.storageKey) || 'null');
      if (saved?.token && saved.expiresAt > Date.now()) {
        Object.assign(this, { token: saved.token, expiresAt: saved.expiresAt, login: saved.login || null });
      } else {
        this.storage.removeItem(this.storageKey);
      }
    } catch (_) {
      this.clear();
    }
  }

  persist() {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({
        token: this.token, expiresAt: this.expiresAt, login: this.login,
      }));
    } catch (_) {}
  }

  /**
   * Consumes `#access_token=…` (or `#error=…`) left by the authorize redirect
   * and scrubs it from the address bar. Returns an error message, if any.
   */
  consumeRedirect(location = window.location, history = window.history) {
    if (!location.hash || location.hash.length < 2) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const accessToken = params.get('access_token');
    const error = params.get('error');
    if (!accessToken && !error) return null;

    history.replaceState(null, '', location.pathname + location.search);
    if (error) return params.get('error_description') || error;

    const expiresIn = Number(params.get('expires_in')) || 7200;
    this.token = accessToken;
    this.expiresAt = Date.now() + expiresIn * 1000 - 60_000;
    this.persist();
    return null;
  }

  setLogin(login) {
    this.login = login;
    this.persist();
  }

  clear() {
    this.token = null;
    this.expiresAt = 0;
    this.login = null;
    try { this.storage.removeItem(this.storageKey); } catch (_) {}
  }
}
