// Role 4 integration entry point. Storage and report modules are owned separately.
// Keep their imports out of the shell until those modules are available.
const screens = [...document.querySelectorAll('[data-screen]')];
const navigation = [...document.querySelectorAll('nav a')];

function showScreen({ focus = false } = {}) {
  const requested = window.location.hash.slice(1);
  const active = screens.find((screen) => screen.id === requested) ?? screens[0];
  for (const screen of screens) screen.hidden = screen !== active;
  for (const link of navigation) {
    if (link.hash === `#${active.id}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (focus) active.querySelector('h2').focus();
}

window.addEventListener('hashchange', () => showScreen({ focus: true }));
showScreen();

for (const button of document.querySelectorAll('[data-focus]')) {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.focus);
    // Photo input stays disabled until persistence and preview handling exist.
    const focusTarget = target.disabled ? document.getElementById('medication-name') : target;
    focusTarget.focus();
    focusTarget.scrollIntoView({ behavior: 'auto', block: 'center' });
  });
}

for (const form of document.querySelectorAll('form')) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    document.getElementById('app-status').textContent =
      'Saving is not connected yet. These entries have not been saved.';
  });
}
