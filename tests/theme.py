"""Brand/layout and immediate control feedback checks; same setup as integration.py."""
import functools
import http.server
from pathlib import Path
import tempfile
import threading

from integration import ROOT, QuietHandler, sync_playwright, expect


def main():
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    artifacts = Path(tempfile.mkdtemp(prefix='caretrail-theme-'))
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for width in [320, 390, 1280]:
                context = browser.new_context(viewport={'width': width, 'height': 900},
                                              has_touch=width < 640)
                page = context.new_page()
                page.goto(url)
                expect(page.locator('#app-status')).to_contain_text('Ready.')
                logo = page.locator('.brand-mark img')
                expect(page.get_by_role('link', name='CareTrail, events')).to_be_visible()
                assert logo.evaluate('img => img.complete && img.naturalWidth > 0')
                assert logo.evaluate('img => Math.abs(img.width / img.height - img.naturalWidth / img.naturalHeight) < .03')
                for screen in ['events', 'medications', 'profile', 'report']:
                    page.locator(f'nav a[href="#{screen}-view"]').click()
                    if screen in ['events', 'medications']:
                        page.locator('#add-event' if screen == 'events' else '#add-medication').click()
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, screen)
                    undersized = page.locator('button, nav a, .file-button, .brand').evaluate_all('''nodes => nodes
                      .filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')
                      .filter(n => n.offsetWidth < 44 || n.offsetHeight < 44)
                      .map(n => n.id || n.textContent)''')
                    assert not undersized, (width, screen, undersized)
                    if screen == 'events':
                        page.evaluate('scrollTo(0, 0)')
                        page.screenshot(path=str(artifacts / f'events-{width}.png'))
                print(f'PASS {width}px: all views fit, proportional logo, 44px control targets')
                context.close()

            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            # Slow only the served test copy of saveProfile; production source is untouched.
            def delayed_storage(route):
                response = route.fetch()
                source = response.text().replace('export async function saveProfile(patch) {',
                    'export async function saveProfile(patch) { await new Promise(r => setTimeout(r, 500));')
                route.fulfill(response=response, body=source)
            page.route('**/storage.js', delayed_storage)
            page.goto(url)
            expect(page.locator('#app-status')).to_contain_text('Ready.')
            button = page.locator('#add-event')
            background = button.evaluate('n => getComputedStyle(n).backgroundColor')
            button.hover()
            page.wait_for_timeout(150)
            assert button.evaluate('n => getComputedStyle(n).backgroundColor') != background
            page.mouse.down()
            assert button.evaluate('n => getComputedStyle(n).transform') != 'none'
            page.mouse.up()
            page.keyboard.press('Tab')
            focused = page.locator(':focus-visible')
            assert focused.count() == 1
            assert focused.evaluate('n => parseFloat(getComputedStyle(n).outlineWidth)') >= 3
            page.locator('nav a[href="#profile-view"]').click()
            page.locator('#profile-name').fill('Fictional feedback test')
            save = page.locator('#save-profile')
            save.click()
            expect(save).to_have_attribute('aria-busy', 'true')
            expect(save).to_be_disabled()
            assert save.evaluate('n => getComputedStyle(n).cursor') == 'progress'
            assert save.evaluate('n => getComputedStyle(n).boxShadow') != 'none'
            expect(page.locator('#profile-message')).to_have_text('Working…')
            expect(page.locator('#app-status')).to_contain_text('Profile saved.')
            expect(save).to_be_enabled()
            expect(save).not_to_have_attribute('aria-busy', 'true')
            print('PASS desktop hover, press, keyboard focus, visible busy state before slow save finishes')

            page.emulate_media(reduced_motion='reduce')
            save.hover()
            page.mouse.down()
            assert save.evaluate('n => getComputedStyle(n).transform') == 'none'
            assert save.evaluate('n => getComputedStyle(n).transitionDuration') == '0s'
            page.mouse.move(0, 0)
            page.mouse.up()
            print('PASS reduced motion removes scale and transitions')
            browser.close()
            print(f'Screenshots: {artifacts}')
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
