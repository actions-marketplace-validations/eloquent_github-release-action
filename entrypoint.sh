#!/usr/bin/env bash

TAG_PATTERN="^refs/tags/(.*)$"
SEMVER_PATTERN="^v?((0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(\\-([0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*))?(\\+([0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*))?)$"

if [[ "$GITHUB_REF" =~ $TAG_PATTERN ]]; then
  TAG=${BASH_REMATCH[1]}
else
  echo Cannot create a release from a non-tag >/dev/stderr
  exit 1
fi

# fetch the annotated tag, GHA creates a fake lightweight tag
git fetch origin --force "$GITHUB_REF:$GITHUB_REF"

if [[ "$(git describe "$TAG")" != "$TAG" ]]; then
  echo Cannot create a release from a lightweight tag >/dev/stderr
  exit 1
fi

if [[ "$TAG" =~ $SEMVER_PATTERN ]]; then
  SEMVER_MAJOR=${BASH_REMATCH[2]}
  SEMVER_PRERELEASE=${BASH_REMATCH[6]}

  if [[ $SEMVER_MAJOR > 0 && -z $SEMVER_PRERELEASE ]]; then
    IS_STABLE="true"
  fi
fi

MESSAGE="$(git tag -ln --format "%(contents)" "$TAG")"

if [[ -n "$IS_STABLE" ]]; then
  echo "Creating stable release for tag $TAG"
  hub release create --message "$MESSAGE" "$TAG"
else
  echo "Creating pre-release for tag $TAG"
  hub release create --prerelease --message "$MESSAGE" "$TAG"
fi
