# caretrail-hackumbc

CareTrail is a static, mobile-first hackathon prototype for patient-entered notes
between appointments. Use fictional data only. It does not provide medical advice
or identify medication from photos.

## Run locally

Serve this directory over HTTP so browser ES modules load:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000`. No build step, backend, or application dependencies
are required. Deploy the static files over HTTPS for iPhone/Home Screen testing.

## Working flow

- Save an optional profile, then add events or medication courses.
- Events may have no details or happened time. Editing preserves their original
  recorded timestamps; the timeline sorts by happened time, otherwise recorded time.
- Take or choose a label photo, check its preview, and save. Name and dates remain
  optional. “Add photo later” visibly marks an incomplete course. Edit cards to
  replace photos, correct details, or mark a course finished/stopped.
- Open Visit Report to review saved information, then use Print / Save (PDF).
  Opening and printing never delete records.
- Start a new visit record only after checking that a report copy exists. The
  separate confirmation clears events and completed courses and their unshared
  photos, retaining the profile and ongoing courses with original dates/photos.

Structured records use localStorage; photos use IndexedDB. Data stays in this
browser context, can be lost if browser storage is cleared, and does not sync.
Use one tab/context during the demo. A PDF alone is not a complete or secure backup.
Save failures keep form drafts. If records save but old photo cleanup fails, the
error offers a cleanup retry. Native date inputs are used; custom calendars are
deferred.

## Browser verification

The repeatable test needs Python, the Python Playwright package, and installed
Google Chrome. These are test tools only:

```sh
python -m pip install playwright
python tests/integration.py
```

The test starts its own localhost server and an isolated browser context. It uses
generated fictional label images and covers profile/photo save and reopen,
incomplete courses, event chronology and immutable timestamps, completion edits,
failed saves and retries, missing images, confirmation/cancellation, report print
invocation, and reset/photo retention. It writes screenshots and PDFs to a
temporary directory printed at the end.

Verified locally in headless Chrome at a 390px mobile viewport on September 27,
2026: the full fictional flow passed with no uncaught browser errors, including
partial photo-cleanup failure recovery and a ten-page report. The print call is
intercepted by the automated test; Chromium PDF output and print styles are also
checked. Actual iPhone Safari persistence, camera capture, larger text, VoiceOver,
and the interactive print/save dialog still need device testing per `spec.md`.

Storage limitation: if an image write succeeds, the record write fails, and the
user abandons that draft, an unattached image may remain in IndexedDB. Retrying
the same draft reuses its photo ID. The current storage API has no standalone
photo-deletion export.
