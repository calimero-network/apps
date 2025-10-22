import { memo } from 'react';
import type { CSSProperties } from 'react';

interface NewMessageIndicatorProps {
  onClick: () => void;
}

const indicatorStyle: CSSProperties = {
  position: 'absolute',
  bottom: '20px',
  right: '20px',
  zIndex: 100,
  height: '40px',
  width: '40px',
  backgroundColor: '#5765F2',
  color: 'white',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  borderRadius: '50%',
  boxShadow: '0 -2px 5px rgba(0,0,0,0.2)',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
};

const arrowStyle = {
  fontSize: '1.5em',
};

const DefaultNewMessageIndicator: React.FC<NewMessageIndicatorProps> = ({
  onClick,
}) => (
  <div onClick={onClick} style={indicatorStyle}>
    <span style={arrowStyle}>↓</span>
  </div>
);

export default memo(DefaultNewMessageIndicator);
