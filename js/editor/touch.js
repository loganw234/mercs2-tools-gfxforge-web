
// -- touch input --------------------------------------------------------------
//
// Reuses the exact same onCanvasMouseDown/onWindowMouseMove/onWindowMouseUp/
// onCanvasDblClick logic as the mouse path — touch events are just normalised
// to {clientX, clientY} and passed straight in, so there is only one source of
// truth for "what does a drag/resize/create actually do".
//
// Touch events are captured by their original target for the whole gesture
// (unlike mouse events), so canvas-scoped listeners are sufficient — no need
// to also listen on window the way the mouse handlers do.

let pinch = null; // { startDist, startZoom }
let lastTap = { time: 0, x: 0, y: 0 };

function touchPoint(t) {
  return { clientX: t.clientX, clientY: t.clientY };
}

function touchDistance(e) {
  const [a, b] = e.touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onCanvasTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    drag = null; // a second finger cancels any single-touch drag in progress
    pinch = { startDist: touchDistance(e), startZoom: state.zoom };
    return;
  }
  if (e.touches.length !== 1) return;
  e.preventDefault();

  const t = e.touches[0];
  const now = Date.now();
  const movedSinceLastTap = Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y);
  const isDoubleTap = (now - lastTap.time) < 350 && movedSinceLastTap < 26;
  lastTap = { time: isDoubleTap ? 0 : now, x: t.clientX, y: t.clientY };

  if (isDoubleTap) {
    onCanvasDblClick(touchPoint(t));
    return;
  }
  onCanvasMouseDown(touchPoint(t));
}

function onCanvasTouchMove(e) {
  if (pinch && e.touches.length === 2) {
    e.preventDefault();
    const dist = touchDistance(e);
    if (dist > 0) setZoom(pinch.startZoom * (dist / pinch.startDist));
    return;
  }
  if (drag && e.touches.length === 1) {
    e.preventDefault(); // dragging an item: don't also let the page/container scroll
    onWindowMouseMove(touchPoint(e.touches[0]));
  }
  // else: no drag in progress — leave the event alone so a one-finger pan of
  // an over-sized stage through the scrollable canvas-area still works.
}

function onCanvasTouchEnd(e) {
  if (e.touches.length > 0) return; // still one finger down (e.g. pinch -> single touch)
  pinch = null;
  if (drag) onWindowMouseUp();
}

function wireTouch() {
  const canvas = document.getElementById('stageCanvas');
  canvas.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onCanvasTouchMove, { passive: false });
  canvas.addEventListener('touchend', onCanvasTouchEnd, { passive: true });
  canvas.addEventListener('touchcancel', onCanvasTouchEnd, { passive: true });
}
