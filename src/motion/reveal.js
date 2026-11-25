// Headings that reveal line by line (dc-pipeline #54): as the page scrolls a heading up the
// screen, from the bottom fifth to just past the middle, each of its lines rises from behind an
// edge, one after another, as far as the scrolling has taken it; then the heading is its own
// markup again, the same nodes, so nothing a site attached to them is lost. Tied to the scrolling,
// not a clock, so it can't be over before anyone looks, or at the foot of the screen (Mena,
// 2026-11-25, of the first, timed version: "too quick to notice"). It never sinks again.
//
// Its still is the heading as written. A heading already on the screen when the page opens stays
// as it is: hiding the page's main heading until a script runs would break "the still paints
// first", and leave it blank if the script failed. So does every heading while the visitor has
// paused motion. While the lines rise, each is a copy of that line's own markup, an <em> and all,
// and the heading reads as the same text, since each line keeps the space that ended it.
//
// It moves only as the visitor scrolls: no pause control (`loops: false`), and the pause control
// leaves it be (`pausable: false`), as it does the scroll story.

const FROM = 0.8; // where the heading's top is when its lines set off, as a share of the screen's height
const TO = 0.45; // and where, when the last is in place
const STAGGER = 0.12; // how far behind the line before each line follows, as a share of the way

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    if (kit.opening || kit.paused()) return {};
    const original = [...element.childNodes];
    const lines = split(element);
    if (lines.length === 0) return {};
    const inners = lines.map((fragment) => {
      // The edge a line rises from: its own box, a little taller, so tall letters aren't cut.
      const edge = document.createElement('span');
      edge.dataset.line = '';
      edge.style.cssText = 'display:block;overflow:hidden;padding-block:0.15em;margin-block:-0.15em';
      const inner = document.createElement('span');
      inner.style.cssText = 'display:block;transform:translateY(110%)';
      inner.append(fragment);
      edge.append(inner);
      return inner;
    });
    // The lines in a flex column, where margins don't collapse: each edge's padding and negative
    // margin cancel exactly, so the heading is its own height throughout. In a block, two
    // neighbours' negative margins count once, and three lines stood 29px taller.
    const column = document.createElement('span');
    column.style.cssText = 'display:flex;flex-direction:column';
    column.append(...inners.map((inner) => inner.parentNode));
    element.replaceChildren(column);
    let done = false;
    let begun = false; // rising
    let way = 0; // how far up the screen the scrolling has taken it, from 0 to 1, never less
    const behind = Math.min(STAGGER, 0.5 / Math.max(inners.length - 1, 1));
    const finish = () => {
      if (done) return;
      done = true;
      element.replaceChildren(...original);
    };

    return {
      frame() {
        if (done) return false;
        const top = element.getBoundingClientRect().top;
        const now = Math.min(Math.max((FROM * innerHeight - top) / ((FROM - TO) * innerHeight), 0), 1);
        if (now <= way && begun) return false;
        way = Math.max(way, now);
        begun = true;
        if (way >= 1) return void finish();
        const span = 1 - behind * (inners.length - 1);
        inners.forEach((inner, i) => {
          const p = Math.min(Math.max((way - i * behind) / span, 0), 1);
          inner.style.transform = `translateY(${((1 - p) ** 2 * 110).toFixed(2)}%)`;
        });
      },
      // Off the screen or in a hidden tab once it has begun to rise: the heading as it is, at
      // once, since nobody is watching it rise.
      pause() {
        if (way > 0) finish();
      },
      destroy: finish,
    };
  },
};

/** The heading's lines as it is laid out now, each a copy of its markup up to the next line's first word. */
function split(element) {
  const starts = []; // the first word of each line: [text node, offset, top]
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const word of node.data.matchAll(/\S+/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const box = range.getBoundingClientRect();
      const last = starts.at(-1);
      if (!last || box.top > last.top + box.height / 2) starts.push({ node, offset: word.index, top: box.top });
    }
  }
  return starts.map((start, i) => {
    const line = document.createRange();
    if (i === 0) line.setStart(element, 0);
    else line.setStart(start.node, start.offset);
    if (i < starts.length - 1) line.setEnd(starts[i + 1].node, starts[i + 1].offset);
    else line.setEnd(element, element.childNodes.length);
    return line.cloneContents();
  });
}
