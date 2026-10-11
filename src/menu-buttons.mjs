// Menu buttons that work from the keyboard: dc-qa's menu check. axe sees a Menu button's name and
// its aria-expanded, but not whether the menu can be used: a concept had its menu earlier in the
// source than the button, moved below the header by CSS `order`, so a keyboard user who opened it
// tabbed straight past it into the page, and passed axe (2026-10-11).
//
// Every visible button with aria-expanded and aria-controls whose target is a <nav>, holds one or
// sits in one is checked, at the width dc-qa runs it at (a button hidden at desktop widths is
// skipped there):
//
// - aria-expanded says what is on screen, before and after;
// - Enter opens the menu, and Tab from the button goes into it, which it does when the menu comes
//   straight after the button in the source;
// - Escape closes it and puts focus back on the button;
// - a click opens it and a second click closes it.
//
// A disclosure that is not a menu (a question and its answer) is left alone: Escape is not
// expected to close one. The page is left as it was found, with the menu closed.

/** Each menu button on the page, as { button, problems }; no problems means it passed. */
export async function checkMenuButtons(page) {
  const results = [];
  for (const button of await page.locator('button[aria-controls][aria-expanded]').all()) {
    if (!(await button.isVisible())) continue;
    const name = await button.evaluate((el) => {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      return `button${el.id ? `#${el.id}` : ''}${[...el.classList].map((c) => `.${c}`).join('')}${text ? ` ("${text.slice(0, 30)}")` : ''}`;
    });
    const id = await button.getAttribute('aria-controls');
    const menu = page.locator(`[id="${id}"]`);
    if (!(await menu.count())) {
      results.push({ button: name, problems: [`aria-controls names #${id}, which is not on the page`] });
      continue;
    }
    if (!(await menu.evaluate((el) => el.matches('nav') || !!el.querySelector('nav') || !!el.closest('nav')))) continue;

    const problems = [];
    const expanded = async () => (await button.getAttribute('aria-expanded')) === 'true';
    const shown = () => menu.evaluate((el) => el.checkVisibility({ visibilityProperty: true }) && el.getBoundingClientRect().height > 1);
    const focused = () => page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'nothing';
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].map((c) => `.${c}`).join('')}${text ? ` ("${text}")` : ''}`;
    });

    if ((await expanded()) !== (await shown())) {
      problems.push(`aria-expanded is "${await button.getAttribute('aria-expanded')}" while the menu is ${(await shown()) ? 'shown' : 'hidden'}`);
    }
    if (await expanded()) await button.click();

    await button.focus();
    await page.keyboard.press('Enter');
    if (!(await expanded())) problems.push('Enter on the button leaves aria-expanded "false"');
    if (!(await shown())) {
      problems.push('Enter on the button does not show the menu');
    } else {
      const focusable = await menu.evaluate((el) =>
        !!el.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'));
      if (focusable) {
        await page.keyboard.press('Tab');
        const inMenu = await menu.evaluate((el) => el.contains(document.activeElement));
        if (!inMenu) {
          problems.push(`Tab from the button goes to ${await focused()}, not into the menu it opened: put the menu straight after the button in the source`);
        }
      }
      await page.keyboard.press('Escape');
      if ((await expanded()) || (await shown())) {
        problems.push('Escape does not close the menu');
      } else if (!(await button.evaluate((el) => el === document.activeElement))) {
        problems.push(`Escape closes the menu but leaves focus on ${await focused()}, not the button`);
      }
    }

    if (await expanded()) await button.click();
    await button.click();
    if (!(await expanded()) || !(await shown())) {
      problems.push('a click does not open the menu');
    } else {
      await button.click();
      if ((await expanded()) || (await shown())) problems.push('a second click does not close the menu');
    }
    if (await expanded()) await button.click();
    results.push({ button: name, problems });
  }
  return results;
}
