declare module '*.svg' {
  const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  export default content;
}

declare module '@calimero-network/mero-icons' {
  import { ComponentType } from 'react';
  
  interface IconProps {
    size?: number | string;
    color?: string;
    style?: React.CSSProperties;
  }
  
  export const Trash: ComponentType<IconProps>;
  export const Eye: ComponentType<IconProps>;
  export const Settings: ComponentType<IconProps>;
  export const FileText: ComponentType<IconProps>;
  export const Folder: ComponentType<IconProps>;
  export const Box: ComponentType<IconProps>;
}
