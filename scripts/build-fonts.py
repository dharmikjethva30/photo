#!/usr/bin/env python3
"""Build the static, subset font files the app bundles.

Google ships all three of our families as VARIABLE fonts. React Native's support
for variable font axes is effectively absent, and `fontWeight: 500` on a custom
family silently renders the wrong face on Android. So the app needs one static
file per weight, named to match the family strings in `packages/tokens/src/fonts.ts`.

This script:
  1. downloads the variable TTFs from google/fonts,
  2. instances each required weight into a static font (fontTools varLib),
  3. subsets to Latin + Latin-Extended-A + the punctuation the design uses,
  4. writes them to apps/mobile/assets/fonts and apps/web/public/fonts,
  5. copies the OFL licences, which the licence requires us to distribute.

Run:  task fonts:build     (uses uv, no global installs)

Idempotent. Safe to re-run; it overwrites its own output.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / "tmp" / "font-src"
TARGETS = [
    REPO / "apps" / "mobile" / "assets" / "fonts",
    REPO / "apps" / "web" / "public" / "fonts",
]
RAW = "https://raw.githubusercontent.com/google/fonts/main"


@dataclass(frozen=True)
class Face:
    """One static font file to produce."""

    out: str  # output family name; MUST match packages/tokens/src/fonts.ts
    source: str  # path within the google/fonts repo
    weight: int  # wght axis value to instance at
    # Web-side grouping: the CSS family plus the weight/style it maps to. Unlike
    # React Native, CSS *can* select a face by weight within one family, so the
    # web uses the natural three families rather than ten.
    css_family: str = ""
    italic: bool = False


# Exactly the faces the design uses — audited from the prototype, not guessed.
# Adding a face here without adding it to tokens/fonts.ts will not be picked up.
EBG = "ofl/ebgaramond/EBGaramond[wght].ttf"
EBG_I = "ofl/ebgaramond/EBGaramond-Italic[wght].ttf"
INTER = "ofl/intertight/InterTight[wght].ttf"
MONO = "ofl/jetbrainsmono/JetBrainsMono[wght].ttf"

FACES = [
    # EB Garamond — every title and all editorial copy.
    Face("EBGaramond-Regular", EBG, 400, "EB Garamond"),
    Face("EBGaramond-Medium", EBG, 500, "EB Garamond"),
    Face("EBGaramond-Italic", EBG_I, 400, "EB Garamond", italic=True),
    Face("EBGaramond-MediumItalic", EBG_I, 500, "EB Garamond", italic=True),
    # Inter Tight — all UI.
    Face("InterTight-Regular", INTER, 400, "Inter Tight"),
    Face("InterTight-Medium", INTER, 500, "Inter Tight"),
    Face("InterTight-SemiBold", INTER, 600, "Inter Tight"),
    Face("InterTight-Bold", INTER, 700, "Inter Tight"),
    # JetBrains Mono — section labels, metadata, receipts.
    Face("JetBrainsMono-Regular", MONO, 400, "JetBrains Mono"),
    Face("JetBrainsMono-Medium", MONO, 500, "JetBrains Mono"),
]

LICENCES = {
    "EBGaramond-OFL.txt": "ofl/ebgaramond/OFL.txt",
    "InterTight-OFL.txt": "ofl/intertight/OFL.txt",
    "JetBrainsMono-OFL.txt": "ofl/jetbrainsmono/OFL.txt",
}

# Latin + Latin-Extended-A covers English and European names, which matters for a
# product whose core content is people's names. Plus the specific punctuation the
# design relies on: the middot separators ("5 members · 184 photos"), en/em
# dashes, curly quotes, the × in "4032×3024", and £ for the price.
UNICODES = ",".join(
    [
        "U+0000-00FF",  # Basic Latin + Latin-1 Supplement
        "U+0100-017F",  # Latin Extended-A
        "U+2000-206F",  # general punctuation (·, –, —, ', ", …)
        "U+20A0-20BF",  # currency symbols (₹, €)
        "U+2122",  # ™
        "U+2190-21BB",  # arrows (→ in "Get photu →")
        "U+2212",  # minus
        "U+2215",  # division slash
        "U+00D7",  # × (multiplication sign, for dimensions)
        "U+2713-2714",  # check marks
    ]
)


def fetch(rel: str, dest: Path) -> Path:
    """Download once and cache. Font sources are large and immutable.

    Uses curl rather than urllib: macOS python.org builds ship without a
    configured SSL trust store, so urllib raises CERTIFICATE_VERIFY_FAILED on a
    machine where curl works fine. Shelling out avoids making every contributor
    run Install Certificates.command.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = f"{RAW}/{urllib.parse.quote(rel)}"
    print(f"  fetching {rel}")
    result = subprocess.run(
        ["curl", "-fsSL", "--retry", "3", "--max-time", "180", "-o", str(dest), url],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"failed to download {rel}: {result.stderr.strip()}")
    if dest.stat().st_size < 1024:
        raise SystemExit(f"suspiciously small download for {rel}: {dest.stat().st_size} bytes")
    return dest


def build_face(face: Face) -> bytes:
    """Instance a variable font at one weight, then subset it."""
    src = fetch(face.source, CACHE / Path(face.source).name)
    font = TTFont(src)

    axes = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes}
    if "wght" not in axes:
        raise SystemExit(f"{face.source} has no wght axis (axes: {list(axes)})")
    lo, hi = axes["wght"]
    if not lo <= face.weight <= hi:
        raise SystemExit(
            f"{face.out}: weight {face.weight} outside {face.source} range {lo}-{hi}"
        )

    # Pin the axis to a single value, producing a genuine static font rather than
    # a variable font with a default. This is the step that makes Android render
    # the correct weight.
    static = instantiateVariableFont(font, {"wght": face.weight}, inplace=False)

    options = subset.Options()
    options.unicodes = subset.parse_unicodes(UNICODES)
    # Keep the features that affect ordinary running text and drop the rest.
    # EB Garamond in particular ships historical ligatures, small caps, swashes and
    # several figure sets that no screen in this design uses; retaining all of them
    # ("*") roughly doubles each serif face. `kern` matters most here — the display
    # type is set at 34-38px with negative tracking, where bad kerning is visible.
    options.layout_features = [
        "kern",
        "liga",
        "clig",
        "calt",
        "rlig",
        "ccmp",
        "mark",
        "mkmk",
        # Tabular figures: upload percentages and countdowns must not jitter as
        # digits change.
        "tnum",
    ]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables = ["DSIG"]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=options.unicodes)
    subsetter.subset(static)

    # Rename the family so the file's internal name matches what RN asks for.
    # RN resolves iOS fonts by their POSTSCRIPT name, not the filename — a
    # mismatch here is the classic "font works on Android, missing on iOS" bug.
    for record in static["name"].names:
        if record.nameID in (1, 3, 4, 6):
            static["name"].setName(face.out, record.nameID, record.platformID,
                                   record.platEncID, record.langID)

    out = CACHE / f"{face.out}.ttf"
    static.save(out)
    return out.read_bytes()


def write_web_css() -> None:
    """Emit @font-face rules for the web app.

    Generated rather than hand-written so it cannot drift from FACES — a missing
    rule shows up as a silent fallback to Georgia, which is easy to miss in review.

    `font-display: swap` is right for the web (text is readable immediately in a
    fallback), whereas the mobile app embeds fonts at build time via the expo-font
    config plugin. Every title in this design is serif, so a runtime font gate on
    mobile would flash on every cold start.
    """
    out = REPO / "apps" / "web" / "public" / "fonts" / "fonts.css"
    lines = [
        "/* GENERATED by scripts/build-fonts.py — do not edit. */",
        "/* Import once in the web app's root layout. */",
        "",
    ]
    # Double quotes, because the generated file is linted like any other and
    # biome's CSS formatter normalises to them. Emitting already-formatted output
    # keeps this file inside the lint gate rather than exempting it, so a
    # malformed rule is caught rather than ignored.
    for f in FACES:
        lines += [
            "@font-face {",
            f'  font-family: "{f.css_family}";',
            f'  src: url("/fonts/{f.out}.ttf") format("truetype");',
            f"  font-weight: {f.weight};",
            f"  font-style: {'italic' if f.italic else 'normal'};",
            "  font-display: swap;",
            "}",
            "",
        ]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf8")
    print(f"  wrote {out.relative_to(REPO)}")


def main() -> int:
    print("Building fonts")
    for d in TARGETS:
        d.mkdir(parents=True, exist_ok=True)

    total = 0
    for face in FACES:
        data = build_face(face)
        total += len(data)
        for d in TARGETS:
            (d / f"{face.out}.ttf").write_bytes(data)
        print(f"  {face.out:<26} {len(data) / 1024:6.1f} KB")

    for name, rel in LICENCES.items():
        src = fetch(rel, CACHE / name)
        for d in TARGETS:
            shutil.copyfile(src, d / name)

    write_web_css()

    print(f"\n{len(FACES)} faces, {total / 1024:.0f} KB total, written to:")
    for d in TARGETS:
        print(f"  {d.relative_to(REPO)}")

    # Cross-check against the tokens package so the two cannot drift.
    tokens = (REPO / "packages" / "tokens" / "src" / "fonts.ts").read_text()
    missing = [f.out for f in FACES if f.out not in tokens]
    if missing:
        print(f"\nWARNING: not referenced in packages/tokens/src/fonts.ts: {missing}")
        return 1
    # fonts.ts lines look like:  'EBGaramond-Regular': 'EBGaramond-Regular.ttf',
    # so the filename is the SECOND quoted string, not the first (the key).
    declared = [
        part
        for line in tokens.splitlines()
        if ".ttf'" in line
        for part in line.split("'")
        if part.endswith(".ttf")
    ]
    built = {f"{f.out}.ttf" for f in FACES}
    orphans = sorted(set(declared) - built)
    if orphans:
        print(f"\nWARNING: fonts.ts declares files this script does not build: {orphans}")
        return 1
    print("\nfonts.ts and this script agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
