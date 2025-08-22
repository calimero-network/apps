#!/bin/bash

# Local deployment test script for MeroDocs ICP Canister
# This script simulates what the CI/CD pipeline does locally

set -e

echo "🧪 Testing MeroDocs ICP Canister Deployment Pipeline"
echo "=================================================="

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "📍 Current directory: $(pwd)"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v dfx &> /dev/null; then
    echo -e "${RED}❌ dfx not found. Please install dfx first.${NC}"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ cargo not found. Please install Rust first.${NC}"
    exit 1
fi

if ! command -v candid-extractor &> /dev/null; then
    echo -e "${YELLOW}Installing candid-extractor...${NC}"
    cargo install candid-extractor
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# We're already in merodocs_registry directory, so no need to cd again

# Start dfx (or use existing instance)
echo -e "${YELLOW}Checking dfx status...${NC}"
if dfx ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ dfx is already running${NC}"
else
    echo -e "${YELLOW}Starting dfx...${NC}"
    dfx start --background --clean
fi

# Create canister (if it doesn't exist)
echo -e "${YELLOW}Creating canister (if needed)...${NC}"
if ! dfx canister id backend > /dev/null 2>&1; then
    echo -e "${YELLOW}Creating backend canister...${NC}"
    dfx canister create backend
else
    echo -e "${GREEN}✅ Backend canister already exists${NC}"
fi

# Build canister
echo -e "${YELLOW}Building canister...${NC}"
dfx build

# Deploy locally
echo -e "${YELLOW}Deploying canister locally...${NC}"
dfx deploy

# Get canister info
echo -e "${YELLOW}Getting canister information...${NC}"
BACKEND_ID=$(dfx canister id backend)

echo ""
echo -e "${GREEN}🎉 Local deployment successful!${NC}"
echo "================================"
echo "Backend Canister ID: $BACKEND_ID"
echo "Local Candid UI: http://127.0.0.1:4943/?canisterId=$(dfx canister id __Candid_UI)&id=$BACKEND_ID"
echo ""
echo "To test the canister, you can:"
echo "1. Visit the Candid UI URL above"
echo "2. Run: dfx canister call backend <method_name>"
echo ""
echo -e "${YELLOW}To stop the local dfx instance: dfx stop${NC}"
