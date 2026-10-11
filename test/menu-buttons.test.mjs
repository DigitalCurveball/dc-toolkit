import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkMenuButtons } from '../src/menu-buttons.mjs';

// Each page is a header with a Menu button, built right or with one of the faults the check is
// for. It runs in a real browser because it is key presses and focus that decide.

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser.close());

const BUTTON = '<button type="button" aria-expanded="false" aria-controls="nav">Menu</button>';
const MENU = '<nav id="nav" aria-label="Main" hidden><ul><li><a href="/a/">Services</a></li><li><a href="/b/">Team</a></li></ul></nav>';
const PAGE = '<main><a href="/x/">A link in the page</a></main>';
const script = ({ expanded = true, escape = true, refocus = true } = {}) => `<script>
  const button = document.querySelector('button');
  const nav = document.getElementById('nav');
  const set = (open) => {
    ${expanded ? "button.setAttribute('aria-expanded', String(open));" : ''}
    nav.hidden = !open;
  };
  button.addEventListener('click', () => set(nav.hidden));
  ${escape ? `document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !nav.hidden) { set(false); ${refocus ? 'button.focus();' : ''} }
  });` : ''}
</script>`;

async function check(body) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.setContent(`<!doctype html><body>${body}</body>`);
  const result = await checkMenuButtons(page);
  await page.close();
  return result;
}

test('a menu straight after its button, with Escape, passes', async () => {
  const result = await check(`<header>${BUTTON}${MENU}</header>${PAGE}${script()}`);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].problems, []);
  assert.match(result[0].button, /^button \("Menu"\)$/);
});

test('a menu earlier in the source, moved below by CSS order, fails Tab', async () => {
  // The fault the check was written for: it looks right, and Tab skips the menu.
  const menu = MENU.replace('<nav ', '<nav style="order: 2; flex-basis: 100%;" ');
  const [result] = await check(`<header style="display: flex; flex-wrap: wrap;"><a href="/">Home</a>${menu}${BUTTON}</header>${PAGE}${script()}`);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /^Tab from the button goes to a \("A link in the page"\), not into the menu/);
});

test('a menu Escape does not close fails', async () => {
  const [result] = await check(`<header>${BUTTON}${MENU}</header>${PAGE}${script({ escape: false })}`);
  assert.deepEqual(result.problems, ['Escape does not close the menu']);
});

test('Escape that closes the menu but drops focus fails', async () => {
  const [result] = await check(`<header>${BUTTON}${MENU}</header>${PAGE}${script({ refocus: false })}`);
  assert.equal(result.problems.length, 1);
  // Chrome still reports the hidden link as focused until something else takes focus.
  assert.match(result.problems[0], /^Escape closes the menu but leaves focus on .+, not the button$/);
});

test('a button whose aria-expanded never changes fails', async () => {
  const [result] = await check(`<header>${BUTTON}${MENU}</header>${PAGE}${script({ expanded: false })}`);
  assert.ok(result.problems.includes('Enter on the button leaves aria-expanded "false"'));
  assert.ok(result.problems.includes('a click does not open the menu'));
});

test('a hidden button, and a disclosure that is not a menu, are left alone', async () => {
  assert.deepEqual(await check(`<header>${BUTTON.replace('<button ', '<button style="display: none;" ')}${MENU}</header>${PAGE}`), []);
  assert.deepEqual(
    await check('<button type="button" aria-expanded="false" aria-controls="answer">What should I bring?</button><div id="answer" hidden>Your <a href="/x/">referral</a>.</div>'),
    []
  );
});

test('the menu is left closed', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.setContent(`<!doctype html><body><header>${BUTTON}${MENU}</header>${PAGE}${script()}</body>`);
  await checkMenuButtons(page);
  assert.equal(await page.getAttribute('button', 'aria-expanded'), 'false');
  assert.equal(await page.isVisible('#nav'), false);
  await page.close();
});
