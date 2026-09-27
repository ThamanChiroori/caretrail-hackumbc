"""Name/photo validation through the real form; same setup as integration.py."""
import base64
import functools
import http.server
import threading

from integration import ROOT, QuietHandler, sync_playwright, expect


def main():
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for editing in [False, True]:
                for has_name, has_photo in [(True, False), (False, True), (True, True), (False, False)]:
                    context = browser.new_context()
                    page = context.new_page()
                    page.goto(f'http://127.0.0.1:{server.server_port}/#medications-view')
                    expect(page.locator('#app-status')).to_contain_text('Ready.')
                    png = page.evaluate("""() => {
                      const c = document.createElement('canvas'); c.width = c.height = 40;
                      return c.toDataURL('image/png').split(',')[1];
                    }""")
                    photo = {'name': 'fictional-label.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(png)}
                    page.locator('#add-medication').click()
                    if editing:
                        page.locator('#medication-name').fill('Fictional original')
                        if has_photo:
                            page.locator('#medication-photo').set_input_files(photo)
                        page.locator('#save-medication').click()
                        expect(page.locator('#app-status')).to_contain_text('Medication saved.')
                        page.locator('[data-action="edit-medication"]').click()
                        # Editing exercises an existing photoId without a new file.
                    elif has_photo:
                        page.locator('#medication-photo').set_input_files(photo)
                    page.locator('#medication-name').fill('Fictional nickname' if has_name else '   ')
                    page.locator('#medication-dose').fill('Fictional draft details')
                    page.locator('#medication-start').fill('2026-09-20')
                    if not has_photo:
                        page.locator('#add-photo-later').click()
                        expect(page.locator('#medication-message')).to_contain_text('save without a photo')
                    before = page.evaluate("localStorage.getItem('caretrail.records.v1')")
                    page.locator('#save-medication').click()
                    if has_name or has_photo:
                        expect(page.locator('#medication-form')).to_be_hidden()
                        data = page.evaluate("JSON.parse(localStorage.getItem('caretrail.records.v1')).medications")
                        assert len(data) == 1
                        assert bool(data[0]['name']) == has_name
                        assert bool(data[0]['photoId']) == has_photo
                        assert data[0]['doseText'] == 'Fictional draft details'
                    else:
                        expect(page.locator('#medication-message')).to_have_text(
                            'Add a label photo or enter a medication name to save.')
                        expect(page.locator('#medication-message')).to_have_attribute('role', 'alert')
                        expect(page.locator('#medication-name')).to_be_focused()
                        expect(page.locator('#medication-form')).to_be_visible()
                        expect(page.locator('#medication-dose')).to_have_value('Fictional draft details')
                        expect(page.locator('#medication-start')).to_have_value('2026-09-20')
                        assert page.evaluate("localStorage.getItem('caretrail.records.v1')") == before
                        # Empty as well as whitespace-only names must be rejected.
                        page.locator('#medication-name').fill('')
                        page.locator('#save-medication').click()
                        expect(page.locator('#medication-name')).to_be_focused()
                        assert page.evaluate("localStorage.getItem('caretrail.records.v1')") == before
                    print(f'PASS {"edit" if editing else "new"}: name={has_name}, photo={has_photo}')
                    context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
