#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$script_dir/../.." && pwd)"
output_path="${1:-$project_dir/build/macos/GitDiff.app}"

/bin/mkdir -p "$(dirname "$output_path")"
/usr/bin/osacompile -s -o "$output_path" "$script_dir/GitDiff.applescript"
/bin/cp "$script_dir/GitDiff.icns" "$output_path/Contents/Resources/applet.icns"
/usr/bin/touch "$output_path"
/usr/bin/codesign --force --deep --sign - "$output_path"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$output_path"
/usr/bin/printf 'Built and verified %s\n' "$output_path"
