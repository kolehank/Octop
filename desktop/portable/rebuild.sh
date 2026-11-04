#!/usr/bin/env bash
# Local one-shot: rebuild dashboard + big screen and the host-platform green zip.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [[ -f "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.nvm/nvm.sh"
  nvm use 24
fi

rm -rf src/octop/dashboard
rm -rf src/octop/bigscreen
rm -rf desktop/portable/runtimes desktop/portable/wheels \
  desktop/portable/.cache desktop/portable/release
rm -f desktop/portable/requirements-*.txt desktop/portable/overrides-*.txt

make build-frontend build-bigscreen
make -f desktop/portable/Makefile green
