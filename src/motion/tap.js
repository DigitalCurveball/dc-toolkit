// Taps on a phone, for the effects that answer one where a mouse would hover (dc-pipeline #52):
// the rippling photos (ripple.js), a dithered photo's pixels (reveal.js) and the spotlight
// (spotlight.js).
//
// Only a tap counts: a touch that lifts quickly without moving, since every scroll on a phone
// starts with a finger down. And none on a link or a button, which the tap opens or presses before
// an effect could show: none at all on an element inside a link, and on an element holding links,
// such as a section, only the taps beside them.

const MOVE = 10; // CSS pixels a touch may move and still be a tap
const LIFT = 400; // milliseconds within which it lifts

/** Calls `handler(event)`, the touch's pointerup, for each tap on `element`. Returns a function that stops listening. */
export function taps(element, handler) {
  if (element.closest('a')) return () => {};
  let touch = null; // a finger down that may yet be a tap
  const listeners = {
    pointerdown(event) {
      if (event.pointerType === 'touch' && event.isPrimary && !event.target.closest('a, button')) touch = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
    },
    pointermove(event) {
      if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > MOVE) touch = null;
    },
    pointerup(event) {
      if (touch?.id !== event.pointerId) return;
      if (performance.now() - touch.at <= LIFT) handler(event);
      touch = null;
    },
    pointercancel: () => (touch = null), // the browser took it for a scroll
  };
  for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener, { passive: true });
  return () => {
    for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener);
  };
}
