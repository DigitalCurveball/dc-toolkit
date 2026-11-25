// Magnetic buttons (dc-pipeline #57): a button leans toward a mouse or pen that comes near, up to
// 10px, its label (`[data-magnet-label]`, if it has one) a little further, and springs back when it
// leaves. The lean is a transform, so the button's place on the page never changes, and it is
// always toward the cursor, so the button never slides away from a click.
//
// Nothing on a phone, where a finger aiming at a button must not chase it; nothing for keyboard
// focus; nothing under reduced motion (the runtime starts nothing) or while motion is paused. It
// moves only in answer to the pointer: no pause control (`loops: false`), and the pause control
// leaves it be (`pausable: false`), but for letting it rest.

const PULL = 10; // CSS pixels it leans, at most
const REACH = 1.6; // how far the pull reaches, in the button's half-widths and half-heights from its centre
const LABEL = 0.5; // how much further the label leans, as a share of the button's lean
const FOLLOW = 0.25; // the lean, as a share of how far the cursor is from the button's centre, up to PULL
const FADE = 0.3; // over the last share of the reach, the lean fades to nothing

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    const label = element.querySelector('[data-magnet-label]');
    let cursor = null; // the mouse or pen, in the window
    let lean = { x: 0, y: 0 };
    let last = 0;
    const move = (event) => {
      if (event.pointerType !== 'touch') cursor = { x: event.clientX, y: event.clientY };
    };
    const away = (event) => {
      if (!event.relatedTarget) cursor = null; // it left the window
    };
    addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', away);

    const draw = () => {
      const moved = Math.abs(lean.x) > 0.05 || Math.abs(lean.y) > 0.05;
      element.style.transform = moved ? `translate(${lean.x.toFixed(2)}px, ${lean.y.toFixed(2)}px)` : '';
      if (label) label.style.transform = moved ? `translate(${(lean.x * LABEL).toFixed(2)}px, ${(lean.y * LABEL).toFixed(2)}px)` : '';
    };

    return {
      frame() {
        const now = performance.now();
        const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        let target = { x: 0, y: 0 };
        if (cursor && !kit.paused()) {
          // Where the button sits without its lean, so the lean doesn't feed on itself.
          const box = element.getBoundingClientRect();
          const cx = box.left + box.width / 2 - lean.x;
          const cy = box.top + box.height / 2 - lean.y;
          const dx = cursor.x - cx;
          const dy = cursor.y - cy;
          const reach = Math.hypot(dx / (box.width / 2), dy / (box.height / 2)) / REACH;
          if (reach < 1) {
            const length = Math.hypot(dx, dy) || 1;
            const size = Math.min(length * FOLLOW, PULL) * Math.min((1 - reach) / FADE, 1);
            target = { x: (dx / length) * size, y: (dy / length) * size };
          }
        }
        const ease = 1 - Math.exp(-delta / 0.12);
        const next = { x: lean.x + (target.x - lean.x) * ease, y: lean.y + (target.y - lean.y) * ease };
        if (Math.abs(next.x - lean.x) < 0.01 && Math.abs(next.y - lean.y) < 0.01 && Math.hypot(target.x - next.x, target.y - next.y) < 0.05) {
          if (lean.x === target.x && lean.y === target.y) return false;
          lean = target;
        } else {
          lean = next;
        }
        draw();
      },
      destroy() {
        removeEventListener('pointermove', move);
        document.removeEventListener('pointerout', away);
        lean = { x: 0, y: 0 };
        draw();
      },
    };
  },
};
