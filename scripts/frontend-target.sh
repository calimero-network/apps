#!/usr/bin/env bash
# The cloud cluster a bundle's served frontend is built for: the build-time
# values that go with the registry scripts/registry-target.sh picked. A bundle in
# the staging registry must sign in against the staging cluster, never prod's.
#
# Run in the publish job, the one that runs in the GitHub `environment:`, since
# only there does `vars.*` see the environment's own variables. Reads its input
# from the environment:
#
#   ENVIRONMENT        the GitHub environment of the job (empty = production)
#   CLUSTER            vars.CALIMERO_CLUSTER       as the publish job sees it
#   DIRECTORY          vars.CALIMERO_DIRECTORY     as the publish job sees it
#   MIN_RELEASE        vars.CALIMERO_MIN_RELEASE   as the publish job sees it
#   OUTSIDE_CLUSTER    vars.CALIMERO_CLUSTER       as a job WITHOUT an environment sees it
#   OUTSIDE_DIRECTORY  vars.CALIMERO_DIRECTORY     likewise
#   OUTSIDE_MIN_RELEASE vars.CALIMERO_MIN_RELEASE  likewise
#
# Prints, in $GITHUB_OUTPUT form:
#   cluster=        VITE_CALIMERO_CLUSTER as configured (may be empty in production)
#   floor_cluster=  the cluster name the build and the derived floor use
#   directory=      the node directory cluster-min-release.py reads
#   min_release=    VITE_CALIMERO_MIN_RELEASE, empty = derive it from floor_cluster
#   cloud_env=      VITE_CALIMERO_ENV: the Calimero Cloud the frontend links to,
#                   asks and trusts. Empty in production (the build sets no
#                   variable, as before); `staging` for the GitHub environment
#                   `staging`, which the build also gives `directory` as
#                   VITE_CALIMERO_DIRECTORY. Any other environment names no
#                   Calimero Cloud and fails.
#
# PRODUCTION (no environment) is today's behaviour: the repository variables,
# cluster eu-shared-1 when CALIMERO_CLUSTER is unset, the production directory.
#
# ANY ENVIRONMENT FAILS CLOSED. GitHub resolves `vars.X` environment first, then
# repository, then organization, so an environment that lacks a variable would
# silently get production's. That is why the values a job without an
# environment sees are passed in too: a value equal to it was inherited, not set
# for this environment.
#   CALIMERO_CLUSTER   required, and not the inherited one: a staging bundle
#                      built for the production cluster signs in against it.
#   CALIMERO_DIRECTORY required, an https URL, not production's and not the
#                      inherited one.
#   CALIMERO_MIN_RELEASE optional; when unset or inherited it is left empty, and
#                      the floor is derived from the environment's own cluster
#                      through its own directory.
# Nothing is printed on a refusal.
set -euo pipefail

PROD_CLUSTER=eu-shared-1
PROD_DIRECTORY=https://manager.cloud.calimero.network/api/directory

fail() {
  echo "::error::$*" >&2
  exit 1
}

environment=${ENVIRONMENT:-}
cluster=${CLUSTER:-}
directory=${DIRECTORY:-}
min_release=${MIN_RELEASE:-}

if [ -z "$environment" ]; then
  floor_cluster=${cluster:-$PROD_CLUSTER}
  directory=$PROD_DIRECTORY
  cloud_env=""
else
  where="the GitHub environment '$environment'"
  case "$environment" in
    staging) cloud_env=staging ;;
    *) fail "$where names no Calimero Cloud: its frontend would link to and trust production (VITE_CALIMERO_ENV is production or staging)" ;;
  esac
  [ -n "$cluster" ] ||
    fail "$where sets no variable CALIMERO_CLUSTER; its bundles would be built for the production cluster"
  if [ -n "${OUTSIDE_CLUSTER:-}" ] && [ "$cluster" = "$OUTSIDE_CLUSTER" ]; then
    fail "CALIMERO_CLUSTER in $where is '$cluster', the repository/organization value: set it on the environment itself"
  fi
  [ "$cluster" != "$PROD_CLUSTER" ] ||
    fail "CALIMERO_CLUSTER in $where is the production cluster '$PROD_CLUSTER'"

  [ -n "$directory" ] ||
    fail "$where sets no variable CALIMERO_DIRECTORY; the attestation floor would be read from the production directory"
  [[ "$directory" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/-]*)?$ ]] ||
    fail "CALIMERO_DIRECTORY in $where is not an https URL: '$directory'"
  if [ "${directory%/}" = "$PROD_DIRECTORY" ] ||
    { [ -n "${OUTSIDE_DIRECTORY:-}" ] && [ "$directory" = "$OUTSIDE_DIRECTORY" ]; }; then
    fail "CALIMERO_DIRECTORY in $where is the production or repository/organization directory: set the environment's own"
  fi

  if [ -n "$min_release" ] && [ "$min_release" = "${OUTSIDE_MIN_RELEASE:-}" ]; then
    echo "::notice::CALIMERO_MIN_RELEASE $min_release is the repository/organization value, not $where's; deriving the floor from $cluster instead" >&2
    min_release=""
  fi
  floor_cluster=$cluster
fi

[[ "$floor_cluster" =~ ^[a-z0-9][a-z0-9.-]*$ ]] ||
  fail "cluster '$floor_cluster' is not a cluster name (variable CALIMERO_CLUSTER)"
[ -z "$min_release" ] || [[ "$min_release" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "CALIMERO_MIN_RELEASE '$min_release' is not X.Y.Z"

echo "cluster=$cluster"
echo "floor_cluster=$floor_cluster"
echo "directory=${directory%/}"
echo "min_release=$min_release"
echo "cloud_env=$cloud_env"
