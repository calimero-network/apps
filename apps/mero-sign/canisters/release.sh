#!/bin/bash

# Version management script for MeroDocs
# Usage: ./release.sh [major|minor|patch]

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if we're on the right branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "master" ] && [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}❌ Please run this script from master/main branch${NC}"
    echo "Current branch: $CURRENT_BRANCH"
    exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}❌ You have uncommitted changes. Please commit or stash them first.${NC}"
    git status --short
    exit 1
fi

# Get current version from git tags
CURRENT_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo -e "${YELLOW}Current version: $CURRENT_VERSION${NC}"

# Parse current version
CURRENT_VERSION_CLEAN=${CURRENT_VERSION#v}  # Remove 'v' prefix
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION_CLEAN"
MAJOR=${VERSION_PARTS[0]:-0}
MINOR=${VERSION_PARTS[1]:-0}
PATCH=${VERSION_PARTS[2]:-0}

# Determine new version
RELEASE_TYPE=${1:-patch}

case $RELEASE_TYPE in
    major)
        NEW_MAJOR=$((MAJOR + 1))
        NEW_MINOR=0
        NEW_PATCH=0
        ;;
    minor)
        NEW_MAJOR=$MAJOR
        NEW_MINOR=$((MINOR + 1))
        NEW_PATCH=0
        ;;
    patch)
        NEW_MAJOR=$MAJOR
        NEW_MINOR=$MINOR
        NEW_PATCH=$((PATCH + 1))
        ;;
    *)
        echo -e "${RED}❌ Invalid release type: $RELEASE_TYPE${NC}"
        echo "Usage: $0 [major|minor|patch]"
        exit 1
        ;;
esac

NEW_VERSION="v${NEW_MAJOR}.${NEW_MINOR}.${NEW_PATCH}"

echo -e "${YELLOW}New version will be: $NEW_VERSION${NC}"
echo ""

# Confirmation
read -p "Do you want to create and push tag $NEW_VERSION? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Release cancelled"
    exit 1
fi

# Update version in Cargo.toml if it exists
if [ -f "backend/Cargo.toml" ]; then
    echo -e "${YELLOW}Updating version in backend/Cargo.toml...${NC}"
    sed -i.bak "s/^version = .*/version = \"${NEW_MAJOR}.${NEW_MINOR}.${NEW_PATCH}\"/" backend/Cargo.toml
    rm backend/Cargo.toml.bak
    git add backend/Cargo.toml
    git commit -m "chore: bump version to ${NEW_VERSION}" || echo "No changes to commit"
fi

# Create and push tag
echo -e "${YELLOW}Creating and pushing tag...${NC}"
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"
git push origin "$NEW_VERSION"

echo ""
echo -e "${GREEN}🎉 Successfully created and pushed tag: $NEW_VERSION${NC}"
echo ""
echo "The CI/CD pipeline will automatically deploy this version to ICP mainnet."
echo "You can monitor the deployment at:"
echo "https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
