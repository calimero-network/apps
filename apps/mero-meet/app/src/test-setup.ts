// React 19 requires this flag before `act()` will drive updates; without it every
// render in a component test logs "The current testing environment is not
// configured to support act(...)" and effects settle unpredictably.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
