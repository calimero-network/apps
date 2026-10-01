.PHONY: install build typecheck lint unit e2e test clean

install:
	pnpm install

build:
	pnpm build

typecheck:
	pnpm exec tsc --noEmit

lint:
	pnpm lint

unit:
	pnpm test

e2e:
	pnpm exec playwright test

e2e-ui:
	pnpm exec playwright test --ui

test: unit e2e

clean:
	rm -rf dist e2e-report playwright-report test-results
