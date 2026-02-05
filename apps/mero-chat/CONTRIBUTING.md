# Contributing to Calimero Chat

Thank you for your interest in contributing to Calimero Chat! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Linting and Formatting](#linting-and-formatting)
- [Opening Pull Requests](#opening-pull-requests)
- [Code Conventions](#code-conventions)

## Getting Started

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [pnpm](https://pnpm.io/) (v8+)
- [Rust](https://www.rust-lang.org/tools/install) (1.89.0 or later)
- [jq](https://stedolan.github.io/jq/) (for build scripts)

You can install `pnpm` globally if you haven't already:

```bash
npm install -g pnpm
```

## Project Structure

This repository contains three main components:

```
calimero-chat/
├── app/          # React/TypeScript frontend application
├── logic/        # Rust WebAssembly smart contract logic
├── logic-js/     # JavaScript/TypeScript SDK logic
└── workflows/    # Example workflow configurations
```

## Development Setup

### Logic (Rust)

The Rust logic compiles to WebAssembly for execution on the Calimero network.

```bash
cd logic

# Add the WebAssembly target
rustup target add wasm32-unknown-unknown

# Build the contract
chmod +x ./build.sh
./build.sh
```

The compiled `.wasm` file will be placed in the `res/` directory.

### Logic JS (TypeScript)

The JavaScript SDK logic provides an alternative implementation.

```bash
cd logic-js

# Install dependencies
pnpm install

# Build the contract
chmod +x ./build.sh
./build.sh
```

### App (React/TypeScript)

The frontend application built with Vite.

```bash
cd app

# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Build for production
pnpm run build
```

## Running Tests

### Rust Logic

```bash
cd logic

# Run tests
cargo test

# Run tests with output
cargo test -- --nocapture
```

### App

Currently, the frontend does not have a dedicated test suite. Contributions to add testing are welcome!

## Linting and Formatting

### Rust

We use `rustfmt` for code formatting and `clippy` for linting.

```bash
cd logic

# Format code
cargo fmt

# Check formatting without making changes
cargo fmt --check

# Run clippy lints
cargo clippy -- -D warnings
```

**Important:** Always run `cargo fmt` before committing Rust code to avoid CI failures.

### TypeScript/JavaScript (App)

We use ESLint for linting and Prettier for formatting.

```bash
cd app

# Run ESLint
pnpm run lint

# Check Prettier formatting
pnpm run prettier

# Fix Prettier formatting
pnpm run prettier:write
```

## Opening Pull Requests

### Before Submitting

1. **Create a feature branch** from `master`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes** following the code conventions below.

3. **Run linters and formatters**:
   ```bash
   # For Rust changes
   cd logic && cargo fmt && cargo clippy -- -D warnings

   # For TypeScript changes
   cd app && pnpm run lint && pnpm run prettier:write
   ```

4. **Test your changes** to ensure nothing is broken.

5. **Commit your changes** using conventional commit format:
   ```bash
   git commit -m "feat: add new feature description"
   ```

### Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>: <short description>
```

**Allowed types:**
- `feat` - A new feature
- `fix` - A bug fix
- `docs` - Documentation changes
- `style` - Code style/formatting changes
- `refactor` - Code changes that neither fix bugs nor add features
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `build` - Build system or dependency changes
- `ci` - CI configuration changes
- `chore` - Other changes
- `revert` - Reverting previous changes

**Examples:**
- `feat: add direct message support`
- `fix: resolve message ordering issue`
- `docs: update README with build instructions`

### Pull Request Guidelines

1. **Title**: Use the same conventional commit format as commit messages.
2. **Description**: Provide a clear description of what your PR does and why.
3. **Link issues**: Reference any related issues using `Fixes #123` or `Closes #123`.
4. **Small PRs**: Keep PRs focused and small when possible.
5. **Review feedback**: Be responsive to review comments and make requested changes.

## Code Conventions

### Rust

- Follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- Use `rustfmt` default formatting
- All public items should have documentation comments
- Prefer `thiserror` for error handling

### TypeScript/React

- Use TypeScript for all new files
- Follow the existing project structure for components and utilities
- Use functional components with hooks
- Keep components small and focused
- Use meaningful variable and function names

### General

- Write clear, self-documenting code
- Add comments for complex logic
- Keep functions and methods small and focused
- Follow existing patterns in the codebase

## Questions?

If you have questions or need help, feel free to:
- Open an issue for discussion
- Check the [Calimero Documentation](https://calimero-network.github.io/introduction/what-is-calimero)

Thank you for contributing!
