const Api = (() => {

  const CACHE_KEY = 'ledger_cache_v1';
  const PIN_SESSION_KEY = 'ledger_pin_v1';

  // Held in memory + sessionStorage only for as long as this tab is open —
  // never written to config.js or anywhere on disk. The server (Api.gs) is
  // the actual source of truth; this is just what gets sent with each
  // request so it can check it.
  let pin = sessionStorage.getItem(PIN_SESSION_KEY) || '';

  function setPin(value) {
    pin = value;
    sessionStorage.setItem(PIN_SESSION_KEY, value);
  }

  function buildUrl(action, opts = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    if (CONFIG.API_KEY) url.searchParams.set('key', CONFIG.API_KEY);
    if (pin) url.searchParams.set('pin', pin);
    // Tells the server (Api.gs) to bypass its own 5-minute ScriptCache too —
    // otherwise a forced client refresh can still come back with stale data
    // if the server-side cache hasn't expired yet.
    if (opts.nocache) url.searchParams.set('nocache', '1');
    return url.toString();
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const ageMinutes = (Date.now() - parsed.savedAt) / 60000;
      if (ageMinutes > CONFIG.CACHE_MINUTES) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (e) {
      // storage full or unavailable — non-fatal, app still works uncached
    }
  }

  function clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      // non-fatal
    }
  }

  async function getAll(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = readCache();
      if (cached) return { data: cached, fromCache: true };
    }

    const res = await fetch(buildUrl('all', { nocache: forceRefresh }));
    if (!res.ok) throw new Error(`API request failed (${res.status})`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    writeCache(data);
    return { data, fromCache: false };
  }

  // ---------- Budget CRUD ----------
  //
  // Sent as text/plain rather than application/json on purpose: a JSON
  // content-type triggers a CORS preflight (OPTIONS) request, which Apps
  // Script Web Apps don't handle. text/plain is a "simple request" so no
  // preflight happens — Api.gs still parses the body as JSON server-side.

  async function postAction(action, payload) {
    const res = await fetch(buildUrl(action), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`API request failed (${res.status})`);

    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.success) throw new Error(data.message || 'Request did not succeed.');

    clearCache(); // budget changed server-side — don't serve stale data next load
    return data;
  }

  function addBudget(payload) {
    return postAction('addBudget', payload);
  }

  function updateBudget(payload) {
    return postAction('updateBudget', payload);
  }

  function deleteBudget(id) {
    return postAction('deleteBudget', { id });
  }

  function addAccount(payload) {
    return postAction('addAccount', payload);
  }

  function updateAccount(payload) {
    return postAction('updateAccount', payload);
  }

  function deleteAccount(id) {
    return postAction('deleteAccount', { id });
  }

  function savePortfolioEntry(payload) {
    return postAction('savePortfolioEntry', payload);
  }

  function deletePortfolioEntry(id) {
    return postAction('deletePortfolioEntry', { id });
  }

  return {
    getAll, addBudget, updateBudget, deleteBudget,
    addAccount, updateAccount, deleteAccount,
    savePortfolioEntry, deletePortfolioEntry,
    setPin
  };
})();