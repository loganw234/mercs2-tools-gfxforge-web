// -- play mode -----------------------------------------------------------------
//
// Buttons are simulated directly from their authored event/arg fields (exactly
// what movie.js bakes into the exported .gfx — see buildMovieFromState), so a
// click always shows precisely what will be sent to the host. Script
// functions go through the real AVM1 interpreter, since that's genuinely
// arbitrary user code. The two are deliberately not wired together: in the
// real game, a button's fscommand goes to native host code, which *might*
// call back into a script function — but that's the host's decision, not
// something this simulator can know, so it only shows what's actually true:
// the event that fires, and (separately) what a given function does if
// called.

function enterPlayMode() {
  const items = clone(state.items).map(it => {
    if (it.kind === 'clip') {
      it._xscale = 100; it._yscale = 100; it._alpha = 100; it._visible = true; it._rotation = 0;
    }
    return it;
  });
  const stage = clone(state.stage);
  playCtx = { stage, items, interpreter: null };

  playCtx.interpreter = Avm1Interp.createInterpreter(items, {
    onTrace: (msg) => logPlay(msg),
    onFsCommand: (cmd, val) => logPlay(`  fscommand(${JSON.stringify(cmd)}, ${JSON.stringify(val)})`),
    onMutate: () => { syncRuntimeText(); render(); },
  });

  playLog = [];
  if (state.script && state.script.trim()) {
    try {
      const code = Compiler.compileSource(state.script);
      playCtx.interpreter.runTopLevel(code);
    } catch (e) {
      logPlay(`⚠ script did not compile: ${e.message}`);
    }
  } else {
    logPlay('(no script — add one in the Script tab to test functions here)');
  }
  syncRuntimeText();

  state.mode = 'play';
  state.selectedIds = new Set();
  document.getElementById('btnPlayToggle').textContent = '⏹ Stop';
  document.getElementById('btnPlayToggle').classList.remove('primary');
  document.getElementById('btnPlayToggle').classList.add('active');
  document.getElementById('playIdle').style.display = 'none';
  document.getElementById('playControls').style.display = 'flex';
  switchToTab('play');
  renderPlayFunctions();
  renderPlayLog();
  render();
  renderProperties(); // shows a "you're in play mode" state instead of item fields
}

function exitPlayMode() {
  state.mode = 'edit';
  playCtx = null;
  document.getElementById('btnPlayToggle').textContent = '▶ Play';
  document.getElementById('btnPlayToggle').classList.add('primary');
  document.getElementById('btnPlayToggle').classList.remove('active');
  document.getElementById('playIdle').style.display = 'block';
  document.getElementById('playControls').style.display = 'none';
  render();
  renderProperties();
  renderLayers();
}

function syncRuntimeText() {
  if (!playCtx) return;
  for (const it of playCtx.items) {
    if (it.kind === 'text' && it.varName) {
      it.__runtimeText = playCtx.interpreter.textValues.get(it.varName);
    }
  }
}

let playLog = [];

function logPlay(msg) {
  playLog.push(msg);
  if (playLog.length > 400) playLog.shift(); // keep the log from growing unbounded in a long session
  renderPlayLog();
}

function renderPlayLog() {
  const box = document.getElementById('playLog');
  if (!box) return;
  box.textContent = playLog.join('\n');
  box.scrollTop = box.scrollHeight;
}

function renderPlayFunctions() {
  const root = document.getElementById('playFunctions');
  root.innerHTML = '';
  if (!playCtx) return;
  const names = playCtx.interpreter.functionNames();
  if (!names.length) {
    root.appendChild(el('p', { class: 'small-note', text: 'No functions defined in the script.' }));
    return;
  }
  for (const name of names) {
    const params = playCtx.interpreter.functionParams(name);
    const inputs = params.map(p => {
      const input = el('input', { type: 'text', placeholder: p, style: 'flex:1;min-width:0;' });
      return input;
    });
    const callBtn = el('button', {
      class: 'ghost', text: 'Call',
      onclick: () => {
        const args = inputs.map(parseLenient);
        playCtx.interpreter.callFunction(name, args);
        syncRuntimeText();
        render();
      },
    });
    const row = el('div', { style: 'display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--border-soft);border-radius:6px;background:var(--panel-2);' }, [
      el('div', { style: 'font-family:var(--mono);font-size:12px;color:var(--amber);', text: `${name}(${params.join(', ')})` }),
      el('div', { style: 'display:flex;gap:6px;' }, [...inputs, callBtn]),
    ]);
    root.appendChild(row);
  }
}

function parseLenient(input) {
  const v = input.value;
  if (v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

// Called from onCanvasMouseDown/touch handlers when state.mode === 'play',
// instead of the normal edit-mode create/move/resize dispatch.
function onPlayCanvasClick(mx, my) {
  if (!playCtx) return;
  for (let i = playCtx.items.length - 1; i >= 0; i--) {
    const it = playCtx.items[i];
    if (it.hidden || it.kind !== 'button' || it._visible === false) continue;
    if (mx >= it.x && mx <= it.x + it.w && my >= it.y && my <= it.y + it.h) {
      simulateButtonClick(it);
      return;
    }
  }
}

function simulateButtonClick(item) {
  logPlay(`● clicked button "${item.label || item.event}"`);
  const arg = (item.arg === null || item.arg === undefined) ? '' : item.arg;
  logPlay(`  fscommand(${JSON.stringify(item.event)}, ${JSON.stringify(arg)})`);
}

function switchToTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

// playCtx is reassigned (not just mutated) by enter/exitPlayMode, so a
// one-time copy of its value (as the test harness's export shim does for
// everything else) would go stale the moment play mode is entered or exited.
// Exposing a getter instead keeps it live.
function getPlayCtx() { return playCtx; }

function wirePlayMode() {
  document.getElementById('btnPlayToggle').addEventListener('click', () => {
    if (state.mode === 'play') exitPlayMode(); else enterPlayMode();
  });
  document.getElementById('btnPlayClearLog').addEventListener('click', () => {
    playLog = [];
    renderPlayLog();
  });
}
