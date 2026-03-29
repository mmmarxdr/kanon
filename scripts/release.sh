#!/usr/bin/env bash
set -euo pipefail

# ─── Kanon Release Script ───────────────────────────────────────────
# Usage: scripts/release.sh [OPTIONS] <patch|minor|major|X.Y.Z>
#
# Options:
#   --dry-run   Preview what would happen without making changes
#   --push      Push commit and tags to remote after release
#   --help      Show this help message
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Flags
DRY_RUN=false
PUSH=false
BUMP_ARG=""

# ─── Parse arguments ────────────────────────────────────────────────

usage() {
  echo "Usage: scripts/release.sh [OPTIONS] <patch|minor|major|X.Y.Z>"
  echo ""
  echo "Options:"
  echo "  --dry-run   Preview what would happen without making changes"
  echo "  --push      Push commit and tags to remote after release"
  echo "  --help      Show this help message"
  echo ""
  echo "Examples:"
  echo "  scripts/release.sh patch          # 0.1.0 -> 0.1.1"
  echo "  scripts/release.sh minor          # 0.1.0 -> 0.2.0"
  echo "  scripts/release.sh major          # 0.1.0 -> 1.0.0"
  echo "  scripts/release.sh 2.0.0          # explicit version"
  echo "  scripts/release.sh --dry-run patch"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --push)
      PUSH=true
      shift
      ;;
    --help|-h)
      usage
      ;;
    -*)
      echo -e "${RED}Error: Unknown option '$1'${NC}" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
    *)
      if [[ -n "$BUMP_ARG" ]]; then
        echo -e "${RED}Error: Multiple version arguments provided${NC}" >&2
        exit 1
      fi
      BUMP_ARG="$1"
      shift
      ;;
  esac
done

if [[ -z "$BUMP_ARG" ]]; then
  echo -e "${RED}Error: Version bump type or explicit version required${NC}" >&2
  echo "Run with --help for usage." >&2
  exit 1
fi

# ─── Read current version ───────────────────────────────────────────

CURRENT_VERSION=$(node -e "
  const pkg = JSON.parse(require('fs').readFileSync('${ROOT_DIR}/package.json', 'utf8'));
  process.stdout.write(pkg.version);
")

echo -e "${CYAN}Current version:${NC} ${CURRENT_VERSION}"

# ─── Calculate new version ───────────────────────────────────────────

calculate_new_version() {
  local current="$1"
  local bump="$2"

  # Check if bump is an explicit semver (X.Y.Z)
  if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$bump"
    return
  fi

  # Parse current version
  local IFS='.'
  read -r major minor patch <<< "$current"

  case "$bump" in
    patch)
      echo "${major}.${minor}.$((patch + 1))"
      ;;
    minor)
      echo "${major}.$((minor + 1)).0"
      ;;
    major)
      echo "$((major + 1)).0.0"
      ;;
    *)
      echo -e "${RED}Error: Invalid bump type '${bump}'. Use patch, minor, major, or X.Y.Z${NC}" >&2
      exit 1
      ;;
  esac
}

NEW_VERSION=$(calculate_new_version "$CURRENT_VERSION" "$BUMP_ARG")
echo -e "${CYAN}New version:${NC}     ${NEW_VERSION}"

# ─── Package files to update ────────────────────────────────────────

PACKAGE_FILES=(
  "${ROOT_DIR}/package.json"
  "${ROOT_DIR}/packages/api/package.json"
  "${ROOT_DIR}/packages/web/package.json"
  "${ROOT_DIR}/packages/mcp/package.json"
  "${ROOT_DIR}/packages/cli/package.json"
  "${ROOT_DIR}/packages/bridge/package.json"
  "${ROOT_DIR}/packages/e2e/package.json"
)

# ─── Dry run mode ───────────────────────────────────────────────────

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo -e "${YELLOW}${BOLD}=== DRY RUN ===${NC}"
  echo -e "${YELLOW}The following changes would be made:${NC}"
  echo ""
  echo -e "  Version bump: ${CURRENT_VERSION} -> ${BOLD}${NEW_VERSION}${NC}"
  echo ""
  echo -e "  Files to update:"
  for f in "${PACKAGE_FILES[@]}"; do
    echo "    - ${f#${ROOT_DIR}/}"
  done
  echo "    - CHANGELOG.md"
  echo ""
  echo -e "  Git commit: ${BOLD}release: v${NEW_VERSION}${NC}"
  echo -e "  Git tag:    ${BOLD}v${NEW_VERSION}${NC}"
  if [[ "$PUSH" == true ]]; then
    echo -e "  Push:       ${BOLD}yes (commit + tags)${NC}"
  else
    echo -e "  Push:       no"
  fi
  echo ""
  echo -e "${YELLOW}No changes were made.${NC}"
  exit 0
fi

# ─── Validate clean working tree ────────────────────────────────────

echo ""
echo -e "${CYAN}Checking working tree...${NC}"

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo -e "${RED}Error: Working tree has uncommitted changes.${NC}" >&2
  echo "Please commit or stash your changes before releasing." >&2
  exit 1
fi

echo -e "${GREEN}Working tree is clean.${NC}"

# ─── Run tests ───────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}Running test suite...${NC}"

if ! (cd "$ROOT_DIR" && pnpm test --run); then
  echo -e "${RED}Error: Tests failed. Release aborted.${NC}" >&2
  exit 1
fi

echo -e "${GREEN}All tests passed.${NC}"

# ─── Bump versions ──────────────────────────────────────────────────

echo ""
echo -e "${CYAN}Updating versions to ${NEW_VERSION}...${NC}"

bump_version() {
  local file="$1"
  local new_version="$2"
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${file}', 'utf8'));
    pkg.version = '${new_version}';
    fs.writeFileSync('${file}', JSON.stringify(pkg, null, 2) + '\n');
  "
}

for f in "${PACKAGE_FILES[@]}"; do
  bump_version "$f" "$NEW_VERSION"
  echo "  Updated ${f#${ROOT_DIR}/}"
done

# ─── Update CHANGELOG.md ────────────────────────────────────────────

echo -e "${CYAN}Updating CHANGELOG.md...${NC}"

CHANGELOG="${ROOT_DIR}/CHANGELOG.md"
TODAY=$(date +%Y-%m-%d)

if [[ -f "$CHANGELOG" ]]; then
  # Insert new version section after ## [Unreleased]
  node -e "
    const fs = require('fs');
    let content = fs.readFileSync('${CHANGELOG}', 'utf8');
    const newSection = '\n\n## [${NEW_VERSION}] - ${TODAY}\n\n### Added\n\n### Changed\n\n### Fixed\n';
    // Insert after [Unreleased] section header
    const unreleased = '## [Unreleased]';
    const idx = content.indexOf(unreleased);
    if (idx !== -1) {
      const afterUnreleased = idx + unreleased.length;
      // Find the next ## section or end of file
      const nextSection = content.indexOf('\n## [', afterUnreleased);
      if (nextSection !== -1) {
        content = content.slice(0, nextSection) + newSection + content.slice(nextSection);
      } else {
        content = content.slice(0, afterUnreleased) + newSection;
      }
    } else {
      // No [Unreleased], prepend after first line
      const firstNewline = content.indexOf('\n');
      content = content.slice(0, firstNewline) + '\n\n## [Unreleased]' + newSection + content.slice(firstNewline);
    }
    fs.writeFileSync('${CHANGELOG}', content);
  "
else
  # Create new CHANGELOG.md
  cat > "$CHANGELOG" << CHANGELOGEOF
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [${NEW_VERSION}] - ${TODAY}

### Added

### Changed

### Fixed
CHANGELOGEOF
fi

echo "  Updated CHANGELOG.md"

# ─── Git commit and tag ─────────────────────────────────────────────

echo ""
echo -e "${CYAN}Creating release commit and tag...${NC}"

cd "$ROOT_DIR"
git add -A
git commit -m "release: v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

echo -e "${GREEN}Created commit and tag ${BOLD}v${NEW_VERSION}${NC}"

# ─── Push (optional) ────────────────────────────────────────────────

if [[ "$PUSH" == true ]]; then
  echo ""
  echo -e "${CYAN}Pushing to remote...${NC}"
  git push && git push --tags
  echo -e "${GREEN}Pushed commit and tags.${NC}"
else
  echo ""
  echo -e "${YELLOW}Remember to push when ready:${NC}"
  echo "  git push && git push --tags"
fi

# ─── Done ────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Release v${NEW_VERSION} complete!${NC}"
