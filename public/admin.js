// public/admin.js
// Progressive enhancement for the /admin moderation surface. Every feature
// it touches already works via plain links/forms without this file loading —
// this only adds a live selected-count and a confirm() prompt before a bulk
// delete. No fetch/XHR anywhere: every action stays a native form submit or
// link navigation that this script merely assists.

/**
 * @param {{checked: boolean}[]} checkboxes
 * @returns {number} how many are checked
 */
export function computeSelectedCount(checkboxes) {
  return checkboxes.filter((cb) => cb.checked).length;
}

if (typeof document !== 'undefined') {
  const checkboxes = () => Array.from(document.querySelectorAll('input[type="checkbox"][form="bulk-form"]'));
  const countEl = document.querySelector('[data-selected-count]');
  const bulkButtons = () => Array.from(document.querySelectorAll('button[form="bulk-form"]'));

  function refresh() {
    const count = computeSelectedCount(checkboxes());
    if (countEl) countEl.textContent = String(count);
    for (const btn of bulkButtons()) btn.disabled = count === 0;
  }

  for (const cb of checkboxes()) cb.addEventListener('change', refresh);
  refresh();

  for (const btn of bulkButtons()) {
    if (btn.dataset.confirm === 'delete') {
      btn.addEventListener('click', (e) => {
        const count = computeSelectedCount(checkboxes());
        if (!window.confirm(`Delete ${count} submission${count === 1 ? '' : 's'}? This cannot be undone.`)) {
          e.preventDefault();
        }
      });
    }
  }
}
