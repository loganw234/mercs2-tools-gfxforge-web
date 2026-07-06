#!/usr/bin/env bash
# Bundles the split gfxforge-web project (index.html + css/ + js/) into a
# single self-contained HTML file at dist/gfxforge-editor.bundled.html.
#
# Useful when you want one file: to paste into a Claude.ai artifact, attach
# to an email, or hand someone who just wants to double-click one thing.
# index.html is the source of truth — run this again after editing anything
# under css/ or js/. Requires python3 (build-time only; the shipped app
# itself has zero runtime dependencies).
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
