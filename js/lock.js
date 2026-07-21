// PIN lock for the dashboard.
//
// The PIN is checked by the server (Api.gs), not in this file — this
// script just collects it, sends it with the first request, and reacts to
// whether the server accepted it. Nothing here decides whether the PIN is
// correct.
//
// Exposes window.AppLock.ready — a promise that resolves once the app is
// allowed to load data (once a correct PIN has been submitted and
// verified by the server, or immediately if this tab already verified one
// earlier this session).

const AppLock = (() => {
  const SESSION_KEY = 'ledger_unlocked_v1';

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function alreadyUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function grantAccess() {
    const overlay = document.getElementById('lockOverlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('is-locked');
    resolveReady();
  }

  function init() {
    // Already verified a PIN with the server earlier this session/tab —
    // Api.js will still send it with every request going forward.
    if (alreadyUnlocked()) {
      grantAccess();
      return;
    }

    document.body.classList.add('is-locked');

    const overlay = document.getElementById('lockOverlay');
    const input = document.getElementById('lockInput');
    const btn = document.getElementById('lockSubmit');
    const err = document.getElementById('lockError');
    if (!overlay || !input || !btn || !err) {
      grantAccess(); // markup missing — fail open rather than trap the user
      return;
    }

    input.focus();

    async function attempt() {
      const value = input.value.trim();
      if (!/^\d{4}$/.test(value)) {
        err.textContent = 'Enter your 4-digit PIN.';
        err.hidden = false;
        return;
      }

      btn.disabled = true;
      err.hidden = true;
      Api.setPin(value);

      try {
        // Real round trip to the server — this both verifies the PIN
        // (the server rejects a wrong one before returning anything) and
        // fetches the actual data in the same request, so nothing is
        // fetched a second time once unlocked.
        await Api.getAll(true);
        sessionStorage.setItem(SESSION_KEY, '1');
        grantAccess();
      } catch (e) {
        if (e.message === 'Unauthorized') {
          err.textContent = 'Incorrect PIN.';
        } else {
          err.textContent = `Couldn't reach the server: ${e.message}`;
        }
        err.hidden = false;
        input.value = '';
        input.focus();
      } finally {
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attempt();
    });
  }

  init();

  return { ready };
})();