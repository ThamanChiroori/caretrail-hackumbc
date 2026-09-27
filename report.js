const text = (value) => String(value ?? '').trim();

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function formatDate(value, includeTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function ageAt(dob, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(dob));
  if (!match) return '';
  const [, year, month, day] = match.map(Number);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day || birth > now) return '';
  let age = now.getFullYear() - year;
  if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age--;
  return `${age} years`;
}

function appendField(container, label, value) {
  const row = element('p', 'report-field');
  const strong = element('strong', '', `${label}: `);
  row.append(strong, document.createTextNode(text(value) || 'Not entered'));
  container.append(row);
}

function medicationLabel(medication) {
  if (text(medication.name)) return text(medication.name);
  const number = medication.displayNumber;
  if (number !== undefined && number !== null && number !== '') {
    return medication.photoId
      ? `Medication photo ${number} — name not entered`
      : `Medication ${number} — photo needed; name not entered`;
  }
  return 'Medication — name not entered';
}

function renderMedication(medication, photoUrls) {
  const card = element('article', 'report-medication');
  const imageUrl = medication.photoId && photoUrls ? photoUrls[medication.photoId] : null;
  if (imageUrl) {
    const image = document.createElement('img');
    image.className = 'report-medication-photo';
    image.src = imageUrl;
    image.alt = `${medicationLabel(medication)} label photo`;
    image.loading = 'eager';
    image.addEventListener('error', () => {
      image.remove();
      card.classList.add('photo-unavailable');
      const note = element('p', 'photo-unavailable-note', 'Label photo unavailable.');
      const heading = card.querySelector('.report-medication-details');
      heading?.prepend(note);
    }, { once: true });
    card.append(image);
  } else {
    card.classList.add('photo-unavailable');
  }

  const details = element('div', 'report-medication-details');
  details.append(element('h3', '', medicationLabel(medication)));
  appendField(details, 'Dose details', medication.doseText);
  appendField(details, 'Start date', formatDate(medication.startedAt) || 'Date not entered');
  const isOngoing = medication.status === 'ongoing';
  appendField(details, 'End date', isOngoing ? 'Ongoing' : (formatDate(medication.endedAt) || 'Date not entered'));
  if (!isOngoing) {
    const reason = medication.completionReason === 'finished_bottle'
      ? 'Finished bottle'
      : medication.completionReason === 'stopped_taking' ? 'Stopped taking' : 'Not entered';
    appendField(details, 'Completion reason', reason);
  }
  card.append(details);
  return card;
}

const eventTypes = {
  symptom: 'Symptom', injury: 'Injury', possible_reaction: 'Possible reaction',
  consultation: 'Consultation', medication_taken: 'Medication taken', other: 'Other'
};

function renderEvent(event, medications) {
  const item = element('article', 'report-event');
  item.append(element('h3', '', eventTypes[event.type] || 'Event'));
  appendField(item, 'Recorded at', formatDate(event.createdAt, true) || 'Date not entered');
  if (text(event.occurredAt)) appendField(item, 'Happened at', formatDate(event.occurredAt, true) || 'Date not entered');
  else appendField(item, 'Happened at', 'Not entered');
  if (text(event.description)) appendField(item, 'Description', event.description);
  else appendField(item, 'Description', 'No details entered.');
  if (text(event.medicationId)) {
    const linked = medications.find((medication) => medication.id === event.medicationId);
    appendField(item, 'Linked medication', linked ? medicationLabel(linked) : 'Medication details not available');
  }
  if (text(event.doseNote)) appendField(item, 'Dose note', event.doseNote);
  return item;
}

export function renderReport({ profile = {}, events = [], medications = [], photoUrls = {} } = {}, mountElement) {
  if (!mountElement) throw new TypeError('renderReport requires a mount element.');
  mountElement.replaceChildren();
  const report = element('article', 'clinician-report');
  report.append(element('p', 'report-created', `Report created ${formatDate(new Date(), true)}`));
  report.append(element('h2', '', 'Visit report'));

  const patient = element('section', 'report-section');
  patient.append(element('h2', '', 'Patient profile'));
  appendField(patient, 'Name', profile.name);
  const age = ageAt(profile.dateOfBirth);
  appendField(patient, 'Age', age || 'Not entered');
  if (text(profile.sex)) appendField(patient, 'Sex', profile.sex);
  if (text(profile.bloodGroup)) appendField(patient, 'Blood group', profile.bloodGroup);
  appendField(patient, 'Allergies', profile.allergies);
  appendField(patient, 'Additional details', profile.additionalInfo);
  report.append(patient);

  const medicationSection = element('section', 'report-section');
  medicationSection.append(element('h2', '', 'Medication courses'));
  if (medications.length) medications.forEach((med) => medicationSection.append(renderMedication(med, photoUrls)));
  else medicationSection.append(element('p', '', 'No medication courses entered.'));
  report.append(medicationSection);

  const eventSection = element('section', 'report-section');
  eventSection.append(element('h2', '', 'Events'));
  const sorted = [...events].sort((a, b) => {
    const ta = Date.parse(a.occurredAt || a.createdAt) || 0;
    const tb = Date.parse(b.occurredAt || b.createdAt) || 0;
    return ta - tb;
  });
  if (sorted.length) sorted.forEach((event) => eventSection.append(renderEvent(event, medications)));
  else eventSection.append(element('p', '', 'No events entered.'));
  report.append(eventSection);
  report.append(element('p', 'report-disclaimer', 'Patient-entered information; not clinically verified.'));
  mountElement.append(report);
}

export function printReport() {
  window.print();
}
