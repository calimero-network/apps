import 'styled-components';
import type { Tokens } from './theme';

// Make `props.theme` in styled-components resolve to the tracker token set.
declare module 'styled-components' {
  export interface DefaultTheme extends Tokens {}
}
