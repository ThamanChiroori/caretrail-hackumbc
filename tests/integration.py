"""Fictional-data browser test. Requires Python, Playwright, and local Chrome.

Run: python tests/integration.py
Uses an isolated browser context and a localhost static server; no real records.
"""
import base64
import functools
import http.server
import re
from pathlib import Path
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.test-tools'))
from playwright.sync_api import sync_playwright, expect


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    artifacts = Path(tempfile.mkdtemp(prefix='caretrail-test-'))
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width': 390, 'height': 844},
                                          timezone_id='America/New_York')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def load():
                page.goto(url)
                expect(page.locator('#app-status')).to_contain_text('Ready.')

            def nav(name):
                page.locator(f'nav a[href="#{name}-view"]').click()
                expect(page.locator(f'#{name}-view')).to_be_visible()

            def saved(kind):
                page.locator(f'#save-{kind}').click()
                expect(page.locator('#app-status')).to_contain_text(f'{kind.capitalize()} saved.')
                expect(page.locator(f'#save-{kind}')).to_be_enabled()

            def records():
                return page.evaluate("JSON.parse(localStorage.getItem('caretrail.records.v1'))")

            def edit_med(record):
                page.locator(f'[data-id="{record["id"]}"] [data-action="edit-medication"]').click()

            def edit_event(record):
                page.locator(f'[data-id="{record["id"]}"] [data-action="edit-event"]').click()

            load()
            nav('profile')
            page.locator('#profile-name').fill('Fictional Taylor Example')
            page.locator('#profile-dob').fill('1990-04-15')
            page.locator('#profile-allergies').fill('Unknown')
            page.locator('#profile-info').fill('<img src=x onerror=alert(1)> fictional note')
            saved('profile')
            load()
            nav('profile')
            expect(page.locator('#profile-name')).to_have_value('Fictional Taylor Example')
            print('PASS profile save/reload and literal user text')

            # A readable, generated fictional bottle label; no external image input.
            png = page.evaluate("""() => {
              const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
              const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 360);
              ctx.fillStyle = 'black'; ctx.font = '28px sans-serif';
              ctx.fillText('FICTIONAL DEMO LABEL', 30, 90);
              ctx.fillText('Example bottle A', 30, 160);
              ctx.fillText('Not a real medication', 30, 230);
              return canvas.toDataURL('image/png').split(',')[1];
            }""")
            photo = {'name': 'fictional-label.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(png)}
            nav('medications')
            page.locator('#add-medication').click()
            page.locator('#medication-photo').set_input_files(photo)
            expect(page.locator('#medication-photo-preview')).to_be_visible()
            page.locator('#starting-today').click()
            today = page.locator('#medication-start').input_value()
            saved('medication')
            first = records()['medications'][0]
            assert first['name'] == '' and first['photoId'] and first['startedAt'] == today
            first_photo = first['photoId']
            first_number = first['displayNumber']
            page.close()
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            load()
            nav('medications')
            expect(page.locator('#medication-list')).to_contain_text(f'Medication photo {first_number}')
            assert page.locator('#medication-list img').evaluate('(img) => img.complete && img.naturalWidth > 0')
            assert records()['medications'][0]['photoId'] == first_photo
            print('PASS unnamed photo course survives page close/reopen in same context')

            page.locator('#add-medication').click()
            page.locator('#add-photo-later').click()
            saved('medication')
            second = records()['medications'][1]
            assert second['startedAt'] is None and second['name'] == '' and second['photoId'] is None
            expect(page.locator(f'[data-id="{second["id"]}"]')).to_contain_text('Photo and name needed')
            edit_med(second)
            page.locator('#medication-name').fill('Fictional course B')
            page.locator('#medication-photo').set_input_files(photo)
            saved('medication')
            assert records()['medications'][1]['startedAt'] is None
            assert records()['medications'][1]['displayNumber'] == second['displayNumber']
            print('PASS photo-later course, visible incomplete state, later photo/name edit')

            nav('events')
            page.locator('#add-event').click()
            saved('event')
            blank_event = records()['events'][0]
            expect(page.locator('#timeline-list')).to_contain_text('No details entered.')
            assert blank_event['occurredAt'] is None
            page.locator('#add-event').click()
            page.locator('#event-type').select_option('medication_taken')
            page.locator('#event-occurred-at').fill('2026-09-20T09:15')
            page.locator('#event-medication').select_option(first['id'])
            page.locator('#event-dose').fill('Fictional dose note')
            saved('event')
            timed_event = records()['events'][1]
            edit_event(blank_event)
            page.locator('#event-description').fill('Fictional edited event')
            saved('event')
            edit_event(timed_event)
            page.locator('#event-occurred-at').fill('2026-09-19T10:30')
            saved('event')
            data = records()
            assert [e['createdAt'] for e in data['events']] == [blank_event['createdAt'], timed_event['createdAt']]
            assert data['events'][1]['occurredAt'] == '2026-09-19T14:30:00.000Z'
            assert page.locator('#timeline-list > article').first.get_attribute('data-id') == timed_event['id']
            print('PASS blank/timed event creation, editing, immutable timestamps, chronology, dose link')

            # Fault injection uses real storage calls with a failing browser API.
            edit_event(blank_event)
            page.locator('#event-description').fill('Keep this failed-save draft')
            page.evaluate("""() => { window.originalSetItem = Storage.prototype.setItem;
              Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; }""")
            page.locator('#save-event').click()
            expect(page.locator('#event-message')).to_contain_text('storage is full')
            expect(page.locator('#event-description')).to_have_value('Keep this failed-save draft')
            assert records()['events'][0]['description'] == 'Fictional edited event'
            page.evaluate('() => { Storage.prototype.setItem = window.originalSetItem; }')
            saved('event')
            assert len(records()['events']) == 2
            print('PASS record failure keeps draft and retry does not duplicate')

            nav('medications')
            edit_med(first)
            page.locator('#medication-status').select_option('completed')
            page.locator('#finished-bottle').click()
            page.locator('#medication-end').fill('2026-09-27')
            saved('medication')
            edit_med(second)
            page.locator('#medication-status').select_option('completed')
            page.locator('#stopped-taking').click()
            saved('medication')
            # Correct a mistaken completion, then complete again.
            edit_med(second)
            page.locator('#medication-status').select_option('ongoing')
            saved('medication')
            assert records()['medications'][1]['endedAt'] is None
            edit_med(second)
            page.locator('#medication-status').select_option('completed')
            page.locator('#stopped-taking').click()
            saved('medication')
            print('PASS both completion reasons and correction back to ongoing')

            page.locator('#add-medication').click()
            page.locator('#medication-name').fill('Fictional ongoing course')
            page.locator('#medication-start').fill('2026-08-01')
            page.locator('#medication-photo').set_input_files(photo)
            # A successful photo write followed by failed structured save.
            page.evaluate("""() => { Storage.prototype.setItem = () => {
              throw new DOMException('Full', 'QuotaExceededError'); }; }""")
            page.locator('#save-medication').click()
            expect(page.locator('#medication-message')).to_contain_text('storage is full')
            expect(page.locator('#medication-name')).to_have_value('Fictional ongoing course')
            expect(page.locator('#medication-photo-preview')).to_be_visible()
            page.evaluate('() => { Storage.prototype.setItem = window.originalSetItem; }')
            saved('medication')
            ongoing = records()['medications'][2]
            assert ongoing['photoId'] and ongoing['startedAt'] == '2026-08-01'
            print('PASS medication draft/photo retained after failed record write')

            # Invalid image keeps details and offers the photo-later route.
            page.locator('#add-medication').click()
            page.locator('#medication-name').fill('Fictional photo failure')
            page.locator('#medication-photo').set_input_files(
                {'name': 'broken.png', 'mimeType': 'image/png', 'buffer': b'invalid image'})
            page.locator('#save-medication').click()
            expect(page.locator('#medication-message')).to_contain_text("Photo couldn't")
            expect(page.locator('#medication-name')).to_have_value('Fictional photo failure')
            page.locator('#add-photo-later').click()
            saved('medication')
            temporary = records()['medications'][3]
            edit_med(temporary)
            page.locator('#delete-medication').click()
            page.locator('#confirm-cancel').click()
            assert len(records()['medications']) == 4
            page.locator('#delete-medication').click()
            page.locator('#confirm-accept').click()
            expect(page.locator('#app-status')).to_contain_text('Medication deleted.')
            assert len(records()['medications']) == 3
            print('PASS invalid image fallback and medication deletion confirmation/cancel')

            nav('report')
            page.locator('#preview-report').click()
            expect(page.locator('#report-message')).to_contain_text('Report updated')
            report = page.locator('#report-content')
            for text in ['Fictional Taylor Example', 'Finished bottle', 'Stopped taking',
                         'Patient-entered information; not clinically verified.',
                         'Placed in the timeline by recorded time.', 'Fictional dose note']:
                expect(report).to_contain_text(text)
            assert report.locator('img').count() == 3
            assert report.locator('img[src="x"]').count() == 0
            before_print = records()
            page.locator('#start-new-record').click()
            expect(page.locator('#report-message')).to_contain_text('Print / Save report first')
            # Verify the real print entry point calls window.print without deleting.
            page.evaluate('() => { window.print = () => { window.printCalls = (window.printCalls || 0) + 1; }; }')
            page.locator('#print-report').click()
            expect(page.locator('#report-message')).to_contain_text('Check that your printed')
            assert page.evaluate('window.printCalls') == 1
            assert records() == before_print
            page.emulate_media(media='print')
            assert page.locator('nav').is_hidden()
            assert page.locator('#print-report').is_hidden()
            expect(report).to_be_visible()
            page.pdf(path=str(artifacts / 'fictional-report.pdf'), format='A4', print_background=True)
            page.emulate_media(media='screen')
            page.screenshot(path=str(artifacts / 'report-mobile.png'), full_page=True)
            print('PASS clinician report, print invocation, print CSS, PDF generation, no print deletion')

            page.locator('#start-new-record').click()
            expect(page.locator('#confirm-accept')).to_be_disabled()
            page.locator('#confirm-cancel').click()
            assert records() == before_print
            page.locator('#start-new-record').click()
            page.locator('#confirm-copy-exists').check()
            page.locator('#confirm-accept').click()
            expect(page.locator('#app-status')).to_contain_text('New visit record started.')
            after = records()
            assert after['profile'] == before_print['profile']
            assert after['events'] == [] and after['medications'] == [ongoing]
            assert page.evaluate("""async (id) => {
              const storage = await import('./storage.js'); return !!await storage.getPhotoBlob(id);
            }""", ongoing['photoId'])
            assert not page.evaluate("""async (id) => {
              const storage = await import('./storage.js'); return !!await storage.getPhotoBlob(id);
            }""", first_photo)
            load()
            assert records()['medications'] == [ongoing]
            print('PASS reset confirmation/cancel, profile/ongoing retention, completed photo deletion, reload')

            nav('events')
            page.locator('#add-event').click()
            saved('event')
            page.locator('[data-action="delete-event"]').click()
            page.locator('#confirm-cancel').click()
            assert len(records()['events']) == 1
            page.locator('[data-action="delete-event"]').click()
            page.locator('#confirm-accept').click()
            expect(page.locator('#app-status')).to_contain_text('Event deleted.')
            assert records()['events'] == []
            print('PASS event deletion confirmation/cancel')

            # A missing persisted image must remain obvious in cards and reports.
            nav('medications')
            edit_med(ongoing)
            page.locator('#medication-photo').set_input_files(photo)
            page.evaluate("""() => {
              window.originalDelete = IDBObjectStore.prototype.delete;
              IDBObjectStore.prototype.delete = () => { throw new Error('Simulated cleanup failure'); };
            }""")
            page.locator('#save-medication').click()
            expect(page.locator('#app-status')).to_contain_text('Record changes were saved')
            assert records()['medications'][0]['photoId'] != ongoing['photoId']
            expect(page.locator('#medication-name')).to_have_value('Fictional ongoing course')
            page.evaluate('() => { IDBObjectStore.prototype.delete = window.originalDelete; }')
            page.get_by_role('button', name='Retry photo cleanup').click()
            expect(page.locator('#app-status')).to_contain_text('Removed photos cleared.')
            assert records()['pendingPhotoDeletes'] == []
            assert len(records()['medications']) == 1
            print('PASS replacement partial success is reported and photo cleanup retries safely')

            # Remove only the test image from IndexedDB to simulate lost photo data.
            lost_id = records()['medications'][0]['photoId']
            page.evaluate("""async (id) => {
              await new Promise((resolve, reject) => {
                const req = indexedDB.open('caretrail.photos', 1);
                req.onsuccess = () => {
                  const db = req.result; const tx = db.transaction('photos', 'readwrite');
                  tx.objectStore('photos').delete(id);
                  tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject;
                }; req.onerror = reject;
              });
            }""", lost_id)
            page.reload()
            expect(page.locator('#app-status')).to_contain_text('photo is unavailable')
            nav('medications')
            expect(page.locator('#medication-list')).to_contain_text('Photo unavailable')
            nav('report')
            expect(page.locator('#report-content')).to_contain_text('Label photo unavailable.')
            print('PASS missing photo does not block records or disappear silently from report')

            # Long notes exercise page fragmentation beyond a single sheet.
            page.evaluate("""async () => {
              const storage = await import('./storage.js');
              await storage.addEvent({description: 'Fictional long note\\n'.repeat(180)});
              for (let i = 0; i < 20; i++) await storage.addEvent({description: `Fictional event ${i}`});
            }""")
            page.locator('#preview-report').click()
            expect(page.locator('#report-message')).to_contain_text('Report updated')
            pdf = page.pdf(path=str(artifacts / 'fictional-multipage-report.pdf'), format='A4')
            pages = len(re.findall(rb'/Type\s*/Page\b', pdf))
            assert pages >= 3, pages
            page.emulate_media(media='print')
            page.set_viewport_size({'width': 794, 'height': 1123})
            page.screenshot(path=str(artifacts / 'print-layout.png'))
            page.emulate_media(media='screen')
            print(f'PASS long report generates {pages} PDF pages')

            assert not errors, errors
            print(f'PASS no uncaught browser errors. Artifacts: {artifacts}')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

