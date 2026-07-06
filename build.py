#!/usr/bin/env python3
"""Bundle index.html + css/style.css + js/**/*.js into one self-contained
HTML file at dist/gfxforge-editor.bundled.html. See build.sh for usage."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

CODEC_FILES = [
    "js/codec/bitio.js",
    "js/codec/swf.js",
    "js/codec/avm1.js",
    "js/codec/compiler.js",
    "js/codec/movie.js",
    "js/codec/verify.js",
    "js/codec/avm1-interpreter.js",
    "js/codec/bitmap.js",
]
EDITOR_FILES = [
    "js/editor/project-io.js",
    "js/editor/render.js",
    "js/editor/interaction.js",
    "js/editor/touch.js",
    "js/editor/panels.js",
    "js/editor/layers-script.js",
    "js/editor/play.js",
    "js/editor/reference-image.js",
    "js/editor/wiring.js",
    "js/editor/autosave.js",
    "js/editor/init.js",
]


def read(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def main():
    html = read("index.html")

    link_tag = '<link rel="stylesheet" href="css/style.css">'
    assert link_tag in html, "index.html doesn't contain the expected stylesheet link"
    css = read("css/style.css")
    html = html.replace(link_tag, "<style>\n" + css + "\n</style>")

    all_files = CODEC_FILES + EDITOR_FILES
    first_tag = f'<script src="{all_files[0]}"></script>'
    last_tag = f'<script src="{all_files[-1]}"></script>'
    start = html.index(first_tag)
    end = html.index(last_tag) + len(last_tag)
    assert start < end, "script tag markers not found in expected order"

    combined = []
    for rel in all_files:
        tag = f'<script src="{rel}"></script>'
        assert tag in html, f"index.html is missing expected tag: {tag}"
        combined.append(f"// ==== {rel} ====\n" + read(rel))
    js_block = "<script>\n" + "\n\n".join(combined) + "\n</script>"

    html = html[:start] + js_block + html[end:]

    out_dir = os.path.join(HERE, "dist")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "gfxforge-editor.bundled.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Bundled -> {out_path} ({html.count(chr(10))} lines)")


if __name__ == "__main__":
    main()
