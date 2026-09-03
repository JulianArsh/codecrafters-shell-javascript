#!/bin/sh
#
# This script is used to run your program on CodeCrafters
# 
# This runs after .codecrafters/compile.sh
#
# Learn more: https://codecrafters.io/program-interface

# Exit early if any commands fail
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec node "$SCRIPT_DIR/app/main.js" "$@"

