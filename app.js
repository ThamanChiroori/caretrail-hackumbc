import * as storage from './storage.js';
import { renderReport, printReport } from './report.js';

const $ = (id) => document.getElementById(id);
const profileForm = $('profile-form');
const eventForm = $('event-form');
const medicationForm = $('medication-form');
const field = (form, name) => form.elements.namedItem(name);
const value = (form, name) => field(form, name).value.trim();
const screens = [...document.querySelectorAll('[data-screen]')];
const navigation = [...document.querySelectorAll('nav a')];
const types = { symptom: 'Symptom', injury: 'Injury', possible_reaction: 'Possible reaction',
  consultation: 'Consultation', medication_taken: 'Medication taken', other: 'Other' };
const reasons = { finished_bottle: 'Finished bottle', stopped_taking: 'Stopped taking' };
let state = { profile: {}, events: [], medications: [] };
let photoUrls = {};
let photoWarning = '';
let selectedPhoto = null;
let selectedPhotoId = null; // Reuse a successful photo write if the record save fails.
let previewUrl = null;
let ready = false;
let busy = false;
let printAttempted = false;

function message(id, text, error = false) {
  const node = $(id);
  node.setAttribute('role', error ? 'alert' : 'status');
  node.textContent = text;
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function dateText(input, time = false) {
  if (!input) return 'Date not entered';
  const date = new Date(time ? input : `${input}T12:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date)
    : 'Date not entered';
}

function medicationLabel(med) {
  return med.name.trim() || (med.photoId ? `Medication photo ${med.displayNumber} — name not entered`
    : `Medication ${med.displayNumber} — photo needed; name not entered`);
}

function incomplete(med) {
  if (!med.photoId) return med.name.trim() ? 'Photo needed' : 'Photo and name needed';
  if (!photoUrls[med.photoId]) return med.name.trim() ? 'Photo unavailable — add or replace photo' : 'Photo unavailable; name not entered';
  return med.name.trim() ? '' : 'Name not entered';
}

function fill(form, record) {
  for (const [key, entry] of Object.entries(record)) {
    const input = field(form, key);
    if (input && input.type !== 'file') input.value = entry ?? '';
  }
}

function showScreen(focus = false) {
  const active = screens.find((screen) => screen.id === location.hash.slice(1)) ?? screens[0];
  for (const screen of screens) screen.hidden = screen !== active;
  for (const link of navigation) {
    if (link.hash === `#${active.id}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (active.id === 'report-view' && ready && !busy) renderCurrentReport();
  if (focus && location.hash !== '#main') active.querySelector('h2').focus();
}

function template(id, record) {
  const card = $(id).content.firstElementChild.cloneNode(true);
  card.dataset.id = record.id;
  return card;
}

function put(card, name, text, optional = false) {
  const node = card.querySelector(`[data-field="${name}"]`);
  node.textContent = text;
  if (optional) node.hidden = !text;
  return node;
}

function clickableCard(card, edit) {
  card.addEventListener('click', (event) => {
    if (!busy && !event.target.closest('button, a, input, select, textarea')) edit();
  });
}

function renderEvents() {
  const list = $('timeline-list');
  list.replaceChildren();
  const events = [...state.events].sort((a, b) =>
    (Date.parse(a.occurredAt || a.createdAt) || 0) - (Date.parse(b.occurredAt || b.createdAt) || 0));
  for (const event of events) {
    const card = template('event-card-template', event);
    put(card, 'type', types[event.type] || 'Other');
    put(card, 'description', event.description || 'No details entered.');
    put(card, 'occurredAt', event.occurredAt ? dateText(event.occurredAt, true) : 'When it happened: not entered');
    put(card, 'createdAt', dateText(event.createdAt, true));
    put(card, 'sortNote', event.occurredAt ? 'Placed by happened time' : 'Placed by recorded time');
    const med = state.medications.find((item) => item.id === event.medicationId);
    put(card, 'medicationName', event.medicationId ? `Linked medication: ${med ? medicationLabel(med) : 'Details unavailable'}` : '', true);
    put(card, 'doseNote', event.doseNote ? `Dose note: ${event.doseNote}` : '', true);
    const edit = card.querySelector('[data-action="edit-event"]');
    edit.setAttribute('aria-label', `Edit ${types[event.type] || 'event'}, recorded ${dateText(event.createdAt, true)}`);
    edit.addEventListener('click', () => { if (!busy) openEvent(event); });
    const remove = card.querySelector('[data-action="delete-event"]');
    remove.setAttribute('aria-label', `Delete ${types[event.type] || 'event'}, recorded ${dateText(event.createdAt, true)}`);
    remove.addEventListener('click', () => deleteEvent(event));
    clickableCard(card, () => openEvent(event));
    list.append(card);
  }
  if (!events.length) list.textContent = 'No events yet. Add an event to get started.';
}

function renderMedications() {
  $('medication-list').replaceChildren();
  $('completed-medications').replaceChildren();
  for (const med of state.medications) {
    const card = template('medication-card-template', med);
    card.dataset.status = med.status;
    put(card, 'status', med.status === 'ongoing' ? 'Ongoing' : reasons[med.completionReason] || 'Completed — reason not entered');
    put(card, 'displayNumber', `Medication ${med.displayNumber}`);
    put(card, 'name', medicationLabel(med));
    put(card, 'startedAt', dateText(med.startedAt));
    put(card, 'endedAt', dateText(med.endedAt));
    put(card, 'completionReason', reasons[med.completionReason] || 'Completion reason not entered');
    card.querySelector('[data-field="completionDetails"]').hidden = med.status !== 'completed';
    put(card, 'doseText', med.doseText, true);
    put(card, 'incomplete', incomplete(med), true);
    const placeholder = put(card, 'photoPlaceholder', med.photoId ? 'Photo unavailable — add or replace photo' : incomplete(med));
    const image = card.querySelector('[data-field="photo"]');
    if (photoUrls[med.photoId]) {
      image.src = photoUrls[med.photoId];
      image.alt = `${medicationLabel(med)}, started ${dateText(med.startedAt)}, ${med.status === 'ongoing' ? 'ongoing' : reasons[med.completionReason] || 'completed'}`;
      image.hidden = false;
      placeholder.hidden = true;
      image.addEventListener('error', () => {
        image.hidden = true;
        placeholder.hidden = false;
        put(card, 'incomplete', 'Photo unavailable — add or replace photo', true);
      }, { once: true });
    }
    const edit = card.querySelector('[data-action="edit-medication"]');
    edit.setAttribute('aria-label', `View or edit ${medicationLabel(med)}`);
    edit.addEventListener('click', () => { if (!busy) openMedication(med); });
    clickableCard(card, () => openMedication(med));
    $(med.status === 'ongoing' ? 'medication-list' : 'completed-medications').append(card);
  }
  for (const id of ['medication-list', 'completed-medications']) {
    if (!$(id).children.length) $(id).textContent = id === 'medication-list' ? 'No ongoing medications.' : 'No completed courses.';
  }
  const select = $('event-medication');
  const selected = select.value;
  select.replaceChildren(new Option('None', ''));
  for (const med of state.medications) select.add(new Option(medicationLabel(med), med.id));
  select.value = state.medications.some((med) => med.id === selected) ? selected : '';
}

function renderCurrentReport() {
  renderReport({ ...state, photoUrls }, $('report-content'));
}

async function refresh() {
  const [profile, events, medications] = await Promise.all([
    storage.getProfile(), storage.listEvents(), storage.listMedications(),
  ]);
  const nextUrls = {};
  const warnings = [];
  await Promise.all([...new Set(medications.map((med) => med.photoId).filter(Boolean))].map(async (id) => {
    if (photoUrls[id]) { nextUrls[id] = photoUrls[id]; return; }
    try {
      const blob = await storage.getPhotoBlob(id);
      if (blob) nextUrls[id] = URL.createObjectURL(blob);
      else warnings.push('A saved label photo is unavailable. Add or replace it in Medications.');
    } catch (error) { warnings.push(error.message); }
  }));
  const previousUrls = photoUrls;
  photoUrls = nextUrls;
  photoWarning = [...new Set(warnings)].join(' ');
  state = { profile, events, medications };
  renderEvents();
  renderMedications();
  renderCurrentReport();
  for (const [id, url] of Object.entries(previousUrls)) if (!nextUrls[id]) URL.revokeObjectURL(url);
}

// No duplicate submissions or form edits may race an asynchronous photo write.
async function run(messageId, action, success, retryCleanup = null) {
  if (busy || !ready) return;
  busy = true;
  const controls = [...document.querySelectorAll('button, input, select, textarea')];
  const disabled = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  message(messageId, 'Working…');
  let committed = false;
  try {
    await action();
    committed = true;
    printAttempted = false;
    $('start-new-record').hidden = true;
    await refresh();
    message(messageId, [success, photoWarning].filter(Boolean).join(' '), !!photoWarning);
    message('app-status', [success, photoWarning].filter(Boolean).join(' '), !!photoWarning);
  } catch (error) {
    if (error.recordsSaved) {
      printAttempted = false;
      $('start-new-record').hidden = true;
      try { await refresh(); } catch { /* Keep the original cleanup error visible. */ }
    }
    const text = committed ? `Changes were saved, but the display could not reload. Reload the page before continuing. ${error.message}` : error.message || 'Could not save. Your entered details are still here. Try again.';
    message(messageId, text, true);
    message('app-status', text, true);
    if (error.recordsSaved && retryCleanup) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry photo cleanup';
      retry.addEventListener('click', () => run('app-status', retryCleanup, 'Removed photos cleared.', retryCleanup));
      $('app-status').append(retry);
    }
  } finally {
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    busy = false;
  }
}

function openEvent(event = null) {
  eventForm.reset();
  fill(eventForm, event || { id: '', type: 'other' });
  $('event-occurred-at').value = localDateTime(event?.occurredAt);
  $('event-recorded-at').textContent = event ? dateText(event.createdAt, true) : 'Set automatically on first save. This time stays unchanged when you edit.';
  $('event-form-heading').textContent = event ? 'Edit event' : 'Add event';
  message('event-message', '');
  eventForm.hidden = false;
  $('event-type').focus();
  eventForm.scrollIntoView({ block: 'start' });
}

function clearSelection() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  selectedPhoto = null;
  selectedPhotoId = null;
  $('medication-camera').value = '';
  $('medication-photo').value = '';
}

function updatePreview() {
  const photoId = value(medicationForm, 'photoId');
  const src = previewUrl || photoUrls[photoId];
  const image = $('medication-photo-preview');
  image.hidden = !src;
  if (src) image.src = src;
  else image.removeAttribute('src');
  $('photo-placeholder').hidden = !!src;
  $('retake-photo').hidden = !src;
  $('replace-photo').hidden = !src;
  const name = value(medicationForm, 'name');
  const note = !selectedPhoto && !photoId ? (name ? 'Photo needed' : 'Photo and name needed')
    : !src ? 'Photo unavailable — add or replace photo' : !name ? 'Name not entered' : '';
  $('medication-incomplete').hidden = !note;
  $('medication-incomplete').textContent = note;
}

function openMedication(med = null) {
  clearSelection();
  medicationForm.reset();
  fill(medicationForm, med || { id: '', photoId: '', status: 'ongoing' });
  $('medication-form-heading').textContent = med ? 'Edit medication' : 'Add medication';
  $('delete-medication').hidden = !med;
  message('medication-message', '');
  medicationForm.hidden = false;
  updatePreview();
  $('medication-camera').focus();
  medicationForm.scrollIntoView({ block: 'start' });
}

function confirmRemoval(title, description, requireCopy = false) {
  if (busy || $('confirm-dialog').open) return Promise.resolve(false);
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-description').textContent = description;
  $('confirm-details').replaceChildren();
  $('confirm-accept').disabled = requireCopy;
  if (requireCopy) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'confirm-copy-exists';
    label.append(checkbox, document.createTextNode(' I checked that my printed or saved report copy exists.'));
    $('confirm-details').append(label);
    checkbox.addEventListener('change', () => { $('confirm-accept').disabled = !checkbox.checked; });
  }
  return new Promise((resolve) => {
    let accepted = false;
    $('confirm-cancel').onclick = () => dialog.close();
    $('confirm-accept').onclick = () => { accepted = true; dialog.close(); };
    dialog.addEventListener('close', () => resolve(accepted), { once: true });
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}

async function deleteEvent(event) {
  if (!await confirmRemoval('Delete event?', 'This permanently deletes this event. It cannot be undone.')) return;
  await run('event-message', async () => {
    await storage.deleteEvent(event.id);
    if (value(eventForm, 'id') === event.id) { eventForm.reset(); eventForm.hidden = true; }
  }, 'Event deleted.');
}

profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(profileForm));
  run('profile-message', () => storage.saveProfile(data), 'Profile saved.');
});

eventForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = value(eventForm, 'id');
  const occurredAt = value(eventForm, 'occurredAt');
  const data = { type: value(eventForm, 'type'), description: value(eventForm, 'description'),
    occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
    medicationId: value(eventForm, 'medicationId') || null, doseNote: value(eventForm, 'doseNote') };
  run('event-message', async () => {
    const saved = id ? await storage.updateEvent(id, data) : await storage.addEvent(data);
    field(eventForm, 'id').value = saved.id;
    $('event-recorded-at').textContent = dateText(saved.createdAt, true);
    eventForm.hidden = true;
  }, 'Event saved.');
});

medicationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = value(medicationForm, 'id');
  const completed = value(medicationForm, 'status') === 'completed';
  if (completed && !value(medicationForm, 'completionReason')) {
    message('medication-message', 'Choose Finished bottle or Stopped taking before saving a completed course.', true);
    return;
  }
  const data = { name: value(medicationForm, 'name'), doseText: value(medicationForm, 'doseText'),
    photoId: value(medicationForm, 'photoId') || null, startedAt: value(medicationForm, 'startedAt') || null,
    status: completed ? 'completed' : 'ongoing', endedAt: completed ? value(medicationForm, 'endedAt') || null : null,
    completionReason: completed ? value(medicationForm, 'completionReason') : null };
  run('medication-message', async () => {
    if (selectedPhoto) {
      if (!selectedPhotoId) selectedPhotoId = await storage.savePhoto(selectedPhoto);
      data.photoId = selectedPhotoId;
    }
    const saved = id ? await storage.updateMedication(id, data) : await storage.addMedication(data);
    fill(medicationForm, saved);
    clearSelection();
    medicationForm.hidden = true;
  }, 'Medication saved.', id ? () => storage.updateMedication(id, {}) : null);
});

for (const id of ['medication-camera', 'medication-photo']) {
  $(id).addEventListener('change', () => {
    const file = $(id).files[0];
    if (!file) return;
    clearSelection();
    selectedPhoto = file;
    previewUrl = URL.createObjectURL(file);
    updatePreview();
    message('medication-message', 'Check that the label is readable before saving.');
  });
}
$('medication-photo-preview').addEventListener('error', () => {
  $('medication-photo-preview').hidden = true;
  $('photo-placeholder').hidden = false;
  message('medication-message', "Photo couldn't be displayed. Choose another image or add it later.", true);
});
$('medication-name').addEventListener('input', updatePreview);
$('retake-photo').addEventListener('click', () => $('medication-camera').click());
$('replace-photo').addEventListener('click', () => $('medication-photo').click());
$('add-photo-later').addEventListener('click', () => {
  clearSelection();
  // Keep an existing saved photo; abandon only a pending replacement.
  updatePreview();
  message('medication-message', value(medicationForm, 'photoId') ? 'Existing photo kept.' : 'Photo needed. You can save now and add a photo later.');
  $('medication-name').focus();
});
$('starting-today').addEventListener('click', () => { $('medication-start').value = localDate(); });
$('choose-start-date').addEventListener('click', () => {
  $('start-date-fields').hidden = false;
  $('choose-start-date').setAttribute('aria-expanded', 'true');
  $('medication-start').focus();
});
$('medication-status').addEventListener('change', () => {
  if ($('medication-status').value === 'completed' && !$('medication-end').value) $('medication-end').value = localDate();
  if ($('medication-status').value === 'ongoing') {
    $('medication-completion').value = '';
    $('medication-end').value = '';
  }
});
for (const button of document.querySelectorAll('[data-completion-reason]')) {
  button.addEventListener('click', () => {
    $('medication-status').value = 'completed';
    $('medication-completion').value = button.dataset.completionReason;
    if (!$('medication-end').value) $('medication-end').value = localDate();
  });
}
$('delete-medication').addEventListener('click', async () => {
  const id = value(medicationForm, 'id');
  if (!id || !await confirmRemoval('Delete medication?', 'This permanently deletes this course and its unshared photo. Events stay, but their link to this course is removed. This cannot be undone.')) return;
  await run('medication-message', async () => {
    try { await storage.deleteMedication(id); }
    catch (error) {
      if (error.recordsSaved) { clearSelection(); medicationForm.hidden = true; }
      throw error;
    }
    clearSelection(); medicationForm.reset(); medicationForm.hidden = true;
  }, 'Medication deleted.', () => storage.deleteMedication(id));
});

$('add-event').addEventListener('click', () => { if (!busy && ready) openEvent(); });
$('add-medication').addEventListener('click', () => { if (!busy && ready) openMedication(); });
$('cancel-event').addEventListener('click', () => { eventForm.hidden = true; $('add-event').focus(); });
$('cancel-medication').addEventListener('click', () => {
  clearSelection(); medicationForm.hidden = true; $('add-medication').focus();
});

async function prepareReport(print = false) {
  if (!ready || busy) return;
  busy = true;
  try {
    await refresh();
    location.hash = 'report-view';
    showScreen();
    await Promise.all([...$('report-content').querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    if (print) {
      printReport();
      printAttempted = true;
      $('start-new-record').hidden = false;
    }
    message('report-message', [print ? 'Check that your printed or saved copy exists before starting a new visit record.' : 'Report updated from saved records.', photoWarning].filter(Boolean).join(' '), !!photoWarning);
  } catch (error) { message('report-message', error.message || 'Report could not be prepared. Try again.', true); }
  finally { busy = false; }
}
$('preview-report').addEventListener('click', () => prepareReport());
$('print-report').addEventListener('click', () => prepareReport(true));
$('start-new-record').addEventListener('click', async () => {
  if (busy || !ready) return;
  if (!printAttempted) {
    message('report-message', 'Use Print / Save report first, then check that your copy exists. Nothing has been cleared.', true);
    return;
  }
  if (!await confirmRemoval('Start new visit record?', 'Permanently clear all current events, completed medication courses, and photos belonging only to those courses. Keep your profile and ongoing medications with their original start dates and photos. This loss is irreversible.', true)) return;
  // Retrying cleanup through an already removed ID cannot clear newer records.
  const removedId = state.medications.find((med) => med.status === 'completed')?.id;
  await run('report-message', async () => {
    try { await storage.startNewRecord(); }
    catch (error) {
      if (error.recordsSaved) { eventForm.hidden = true; medicationForm.hidden = true; clearSelection(); }
      throw error;
    }
    eventForm.reset(); medicationForm.reset(); clearSelection();
    eventForm.hidden = true; medicationForm.hidden = true;
  }, 'New visit record started. Profile and ongoing medications kept.', removedId ? () => storage.deleteMedication(removedId) : null);
});

// Native date controls are the working date UI for this integration step.
for (const button of document.querySelectorAll('[data-calendar-trigger]')) button.hidden = true;
$('event-occurred-at').step = '0.001';
$('profile-blood').add(new Option('Not entered', ''), 0);
window.addEventListener('hashchange', () => showScreen(true));
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return; // Keep URLs alive in Safari's back/forward cache.
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  Object.values(photoUrls).forEach((url) => URL.revokeObjectURL(url));
});

eventForm.hidden = true;
medicationForm.hidden = true;
showScreen();
message('app-status', 'Loading saved records…');
try {
  await refresh();
  fill(profileForm, state.profile);
  ready = true;
  message('app-status', photoWarning || 'Ready. Fictional data only. Records stay in this browser on this device.', !!photoWarning);
} catch (error) {
  message('app-status', `${error.message} Reload the page to try again.`, true);
  for (const id of ['save-profile', 'save-event', 'save-medication', 'print-report', 'preview-report', 'start-new-record']) $(id).disabled = true;
}
