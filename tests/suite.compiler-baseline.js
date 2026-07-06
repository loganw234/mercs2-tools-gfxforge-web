const fs = require('fs');
const path = require('path');
const { loadContext, test, assert } = require('./run.js');

function hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.compiler-baseline.json'), 'utf8'));

test('compiler: all 54 Python-cross-checked baseline programs still compile byte-identically', () => {
  const ctx = loadContext();
  let fails = [];
  for (const c of baseline) {
    if (c.src.startsWith('EXPR:')) {
      const src = c.src.slice(5);
      try {
        const got = hex(ctx.Compiler.compileExpression(src));
        if (c.ok && got !== c.hex) fails.push(`${JSON.stringify(src)}: got ${got} want ${c.hex}`);
      } catch (e) {
        if (c.ok) fails.push(`${JSON.stringify(src)}: threw ${e.message}`);
      }
    } else {
      try {
        const got = hex(ctx.Compiler.compileSource(c.src));
        if (c.ok && got !== c.hex) fails.push(`${JSON.stringify(c.src)}: got ${got} want ${c.hex}`);
      } catch (e) {
        if (c.ok) fails.push(`${JSON.stringify(c.src)}: threw ${e.message}`);
      }
    }
  }
  assert(fails.length === 0, `${fails.length} regressions:\n` + fails.join('\n'));
});
