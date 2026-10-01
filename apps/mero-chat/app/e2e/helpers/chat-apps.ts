import type { Route } from "@playwright/test";

/**
 * Answer `GET /admin-api/applications` with chat installed under the ids these
 * mocks' namespaces target. mero-chat lists only namespaces whose target app
 * is chat's (by configured id or by package), so a mock that serves
 * namespaces must also say which installed apps are chat — as a real node does.
 */
export function fulfillChatApps(route: Route, ids: string[] = ["app-1", "app-x"]) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { apps: ids.map((id) => ({ id, package: "com.calimero.chat" })) } }),
  });
}
