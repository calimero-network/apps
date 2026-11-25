#!/usr/bin/env bash
# Which App Registry a Release run publishes to, decided by the branch it runs
# on. THE ONE PLACE that maps a branch to a registry: release.yml calls this and
# passes the answer to publish-bundle.yml and publish-component.yml, which take
# the registry only as an input and never fall back to a default of their own.
#
# Usage:
#   scripts/registry-target.sh GIT_REF     e.g. refs/heads/main ($GITHUB_REF)
#
# Prints, in $GITHUB_OUTPUT form:
#   registry_url=https://...   the registry to read versions from and publish to
#   environment=NAME           the GitHub environment the publish job runs in
#                              (empty = none). Its CALIMERO_REGISTRY_API_KEY
#                              overrides the organization secret of that name,
#                              which is the PRODUCTION registry's key.
#   publish_on_push=always|gated
#                              `always`: a push publishes the component apps it
#                              changed. `gated`: only when the repository
#                              variable RELEASE_COMPONENTS_ON_PUSH is true
#                              (today's behaviour on main); otherwise a push
#                              only reports, and a release is a dispatch.
#
# FAILS CLOSED: a tag, a pull-request ref, or any branch not listed below exits
# non-zero and prints nothing, so release.yml publishes nothing.
#
# The registry signer is the same everywhere on purpose: MERO_SIGN_KEY stays the
# organization secret, because the registry pins the signer per package and the
# node derives the application id from (package, signer).
#
# THE PLANNED SWITCH is an edit to the `case` below and nothing else (plus
# adding the new branch to release.yml's `on.push.branches`):
#   main)    -> the staging line (registry $STAGING, environment staging, always)
#   prod)    -> the production line (registry $PROD, no environment, gated)
#   staging-test) -> removed
# The frontend a bundle carries follows the environment, not the branch: its
# cluster comes from the environment's own variables (scripts/frontend-target.sh),
# so the switch needs no change there.
set -euo pipefail

PROD=https://apps.calimero.network
STAGING=https://apps.staging.cloud.calimero.network

fail() {
  echo "::error::$*" >&2
  exit 1
}

ref=${1:-}
case "$ref" in
  refs/heads/?*) branch=${ref#refs/heads/} ;;
  *) fail "Release publishes from a branch, not '$ref' — nothing is published" ;;
esac

case "$branch" in
  main)
    registry_url=$PROD environment="" publish_on_push=gated
    ;;
  staging-test)
    registry_url=$STAGING environment=staging publish_on_push=always
    ;;
  *)
    fail "branch '$branch' has no registry in scripts/registry-target.sh — nothing is published"
    ;;
esac

# Only production may run without an environment: without one the publish job
# gets the organization's CALIMERO_REGISTRY_API_KEY, the production key, and it
# must never be sent to another host.
if [ "$registry_url" != "$PROD" ] && [ -z "$environment" ]; then
  fail "branch '$branch' targets $registry_url without a GitHub environment; it would be sent the production registry key"
fi

echo "registry_url=$registry_url"
echo "environment=$environment"
echo "publish_on_push=$publish_on_push"
