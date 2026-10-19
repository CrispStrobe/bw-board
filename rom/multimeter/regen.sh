#!/usr/bin/env bash
# Regenerate the multimeter ROM from sb3-creator's current 76-multimeter.
# Run this whenever examples/76-multimeter/program.bw changes there — the
# committed .ihx is a fixture and goes stale silently otherwise (it did:
# stage-two °C shipped while this ROM was still stage-one mV, 2026-08-17).
set -euo pipefail
SB3="${SB3_CREATOR:-$HOME/code/sb3-creator}"
[ -d "$SB3" ] || SB3="$(dirname "$0")/../../../sb3-creator"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
node --input-type=module -e "
import SB3Creator from '$SB3/src/utils/sb3Creator.js';
import fs from 'fs';
const c = new SB3Creator();
c.parse(fs.readFileSync('$SB3/examples/76-multimeter/program.bw','utf8'));
fs.writeFileSync('$tmp/mm.c', c.generateC());
"
( cd "$tmp" && sdcc -mmcs51 --std-c99 --iram-size 256 --xram-size 1792 \
    --code-size 61440 mm.c )
cp "$tmp/mm.ihx" "$here/76-multimeter.ihx"
echo "regenerated $here/76-multimeter.ihx from $SB3/examples/76-multimeter"
