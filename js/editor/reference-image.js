// -- reference image underlay --------------------------------------------------
//
// A tracing aid only: draws a user-supplied screenshot behind the stage at
// adjustable opacity/offset/scale, so HUD elements can be positioned against
// real pixels. Deliberately kept OUT of `state` (and therefore out of
// serializeProject/autosave) — it's a personal, ephemeral session aid, not
// part of the design, and a full-resolution screenshot's data URL could be
// large enough to make autosaving it wasteful or hit storage quotas for no
// real benefit.

let referenceImage = null; // { img, opacity, offsetX, offsetY, scale, visible } | null

function drawReferenceImage(ctx) {
  if (!referenceImage || !referenceImage.visible || !referenceImage.img) return;
  const r = referenceImage;
  ctx.save();
  ctx.globalAlpha = r.opacity;
  const w = r.img.naturalWidth * (r.scale / 100);
  const h = r.img.naturalHeight * (r.scale / 100);
  ctx.drawImage(r.img, r.offsetX, r.offsetY, w, h);
  ctx.restore();
}

function loadReferenceImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('That file doesn\'t look like an image', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      referenceImage = { img, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 100, visible: true };
      showReferenceControls();
      render();
    };
    img.onerror = () => showToast('Could not decode that image', 'error');
    img.src = reader.result;
  };
  reader.onerror = () => showToast('Could not read the selected file', 'error');
  reader.readAsDataURL(file);
}

function showReferenceControls() {
  document.getElementById('refImageIdle').style.display = referenceImage ? 'none' : 'block';
  document.getElementById('refImageControls').style.display = referenceImage ? 'flex' : 'none';
  if (referenceImage) {
    document.getElementById('refOpacity').value = Math.round(referenceImage.opacity * 100);
    document.getElementById('refOffsetX').value = referenceImage.offsetX;
    document.getElementById('refOffsetY').value = referenceImage.offsetY;
    document.getElementById('refScale').value = referenceImage.scale;
    document.getElementById('refVisible').checked = referenceImage.visible;
  }
}

function removeReferenceImage() {
  referenceImage = null;
  showReferenceControls();
  render();
}

// referenceImage is reassigned (not mutated), so a one-time copy of its
// value (as the test harness's export shim does for most things) would go
// stale the moment it's set or cleared — same reasoning as getPlayCtx().
function getReferenceImage() { return referenceImage; }

function wireReferenceImage() {
  document.getElementById('btnRefUpload').addEventListener('click', () => document.getElementById('refImageFileInput').click());
  document.getElementById('refImageFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadReferenceImageFile(file);
  });
  document.getElementById('btnRefRemove').addEventListener('click', removeReferenceImage);
  document.getElementById('refOpacity').addEventListener('input', (e) => {
    if (referenceImage) { referenceImage.opacity = Math.max(0.05, Math.min(1, e.target.value / 100)); render(); }
  });
  document.getElementById('refOffsetX').addEventListener('input', (e) => {
    if (referenceImage) { referenceImage.offsetX = parseFloat(e.target.value) || 0; render(); }
  });
  document.getElementById('refOffsetY').addEventListener('input', (e) => {
    if (referenceImage) { referenceImage.offsetY = parseFloat(e.target.value) || 0; render(); }
  });
  document.getElementById('refScale').addEventListener('input', (e) => {
    if (referenceImage) { referenceImage.scale = Math.max(1, parseFloat(e.target.value) || 100); render(); }
  });
  document.getElementById('refVisible').addEventListener('change', (e) => {
    if (referenceImage) { referenceImage.visible = e.target.checked; render(); }
  });
}
