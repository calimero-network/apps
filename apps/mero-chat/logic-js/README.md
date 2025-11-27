# Curb Chat Logic (JavaScript)

Curb Chat application logic built with Calimero JavaScript SDK. This project compiles TypeScript to WebAssembly for the Calimero P2P platform.

## Prerequisites

- **Node.js** (v18 or higher)
- **pnpm** (package manager)
- **macOS** or **Linux** (x64 or arm64)

## Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Install build dependencies (QuickJS, WASI-SDK, Binaryen):
   ```bash
   pnpm postinstall
   ```

   This step downloads and installs:
   - QuickJS v0.1.3 (~1MB) - JavaScript to C compiler
   - WASI-SDK v11 (~39MB) - WebAssembly System Interface SDK
   - Binaryen v0.1.16 (~3MB) - WebAssembly optimization tools

   **Note:** The `postinstall` script runs automatically after `pnpm install`, but you can run it manually if needed.

## Building

Build the WebAssembly file:

```bash
./build.sh
```

Or manually:

```bash
pnpm build:manual
```

This will:
1. Compile TypeScript source files
2. Bundle with Rollup
3. Compile JavaScript to C using QuickJS
4. Compile C to WebAssembly using WASI-SDK
5. Optimize the WASM file with Binaryen
6. Output: `build/curb.wasm`

## Project Structure

```
logic-js/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── events.ts                # Global event definitions
│   ├── channelManagement/       # Channel management logic
│   ├── dmManagement/            # Direct message management
│   ├── messageManagement/       # Message handling logic
│   ├── types/                   # Type definitions
│   └── utils/                   # Utility functions
├── build/                       # Build output directory
├── build.sh                     # Build script
├── package.json                 # Dependencies and scripts
└── tsconfig.json                # TypeScript configuration
```

## Scripts

- `pnpm install` - Install npm dependencies
- `pnpm postinstall` - Install build dependencies (QuickJS, WASI-SDK, Binaryen)
- `pnpm build:manual` - Build the WebAssembly file
- `pnpm clean` - Remove build directory

## Development

The project uses TypeScript with the following key features:
- **Module Resolution**: Bundler mode for modern ESM
- **Target**: ES2022
- **Strict Mode**: Enabled for type safety

## Troubleshooting

### "QuickJS compiler not found"

If you see this error, run:
```bash
pnpm postinstall
```

This will install QuickJS and other required build tools.

### Build fails with TypeScript errors

Make sure your `tsconfig.json` is properly configured. The project requires:
- `moduleResolution: "bundler"`
- `target: "ES2022"`
- Proper include/exclude paths

## License

Private project - All rights reserved

