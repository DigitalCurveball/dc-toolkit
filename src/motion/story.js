// A pinned scroll story (dc-pipeline #53): steps that each pair a picture with a few lines, the
// picture pinned beside them (above them on a phone) by story.css, with CSS's own `position:
// sticky`, so the browser does the scrolling. This says only which step is being read: the one
// whose lines have reached the middle of the screen, or of what the pinned picture leaves of it on
// a phone. Its picture takes over with a cross-fade (story.css), drifting a little as the step
// scrolls (--dc-story-drift, from 0 to 1, on that picture), and --dc-story-total, on
// .dc-story-steps, says how far through it the reader is, for the line that fills: it is set on the
// element the line is drawn by, never on the story, so a frame restyles the line and not every step.
//
// Tabbing into a step shows its picture, until the page scrolls on. The reading order is the
// markup's, each picture before its lines, whatever shows.
//
// It moves only as the visitor scrolls: it plays no part in the pause control (`pausable: false`),
// since a story stopped mid-scroll would show the wrong step's picture, and needs none
// (`loops: false`). It draws nothing, so it runs wherever scripts do.

export default {
  loops: false,
  pausable: false,
  setup(element) {
    const list = element.querySelector('.dc-story-steps');
    const steps = [...element.querySelectorAll('.dc-story-step')];
    const texts = steps.map((step) => step.querySelector('.dc-story-text'));
    const pictures = steps.map((step) => step.querySelector('.dc-story-picture'));
    if (!list || steps.length < 2 || texts.includes(null) || pictures.includes(null)) {
      console.error('dc-motion: a scroll story needs a .dc-story-steps holding two or more .dc-story-step, each with a .dc-story-picture and a .dc-story-text');
      return null;
    }
    let shown = -1;
    let last = '';
    let focused = null; // a step tabbed into, and where the story was when it was

    const focus = (event) => {
      const i = steps.findIndex((step) => step.contains(event.target));
      if (i >= 0) focused = { i, at: texts[0].getBoundingClientRect().top };
    };
    element.addEventListener('focusin', focus);

    return {
      frame() {
        const first = texts[0].getBoundingClientRect();
        if (focused && Math.abs(first.top - focused.at) > 1) focused = null; // scrolled on
        const state = [first.top, innerWidth, innerHeight, focused?.i].join(' ');
        if (state === last) return false;
        last = state;

        // The middle of the screen beside the picture, or of what it leaves below it on a phone.
        const picture = pictures[0].getBoundingClientRect();
        const beside = picture.left >= first.right - 1 || picture.right <= first.left + 1;
        const line = beside ? innerHeight / 2 : (Math.max(picture.bottom, 0) + innerHeight) / 2;
        const tops = texts.map((text) => text.getBoundingClientRect().top);
        const end = texts.at(-1).getBoundingClientRect().bottom;
        let reading = 0;
        tops.forEach((top, i) => {
          if (top <= line) reading = i;
        });
        if (focused) reading = focused.i;
        const until = reading < tops.length - 1 ? tops[reading + 1] : end;
        const within = clamp((line - tops[reading]) / (until - tops[reading]));

        if (reading !== shown) {
          pictures[shown]?.classList.remove('is-active');
          pictures[reading].classList.add('is-active');
          shown = reading;
        }
        pictures[reading].style.setProperty('--dc-story-drift', within.toFixed(3));
        list.style.setProperty('--dc-story-total', clamp((line - tops[0]) / (end - tops[0])).toFixed(3));
      },
      destroy() {
        element.removeEventListener('focusin', focus);
        for (const picture of pictures) {
          picture.classList.remove('is-active');
          picture.style.removeProperty('--dc-story-drift');
        }
        list.style.removeProperty('--dc-story-total');
      },
    };
  },
};

const clamp = (n) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
