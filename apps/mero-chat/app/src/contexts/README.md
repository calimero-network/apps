# WebSocket Context

Global WebSocket subscription management via React Context.

## Architecture

```
App Tree:
├── CalimeroProvider (SDK)
│   └── WebSocketProvider (Global WS management) ← NEW!
│       └── ToastProvider
│           └── App
│               └── Your Components
```

## Usage

### 1. Access WebSocket Subscription

```typescript
import { useWebSocket } from '../contexts/WebSocketContext';

function MyComponent() {
  const webSocket = useWebSocket();
  
  // Subscribe to contexts
  webSocket.subscribeToContext("context-id-123");
  webSocket.subscribeToContexts(["ctx-1", "ctx-2", "ctx-3"]);
  
  // Unsubscribe
  webSocket.unsubscribeFromContext("context-id-123");
  webSocket.unsubscribeAll();
  
  // Check subscription state
  const isSubscribed = webSocket.isSubscribed();
  const count = webSocket.getSubscriptionCount();
  const contexts = webSocket.getSubscribedContexts();
}
```

### 2. Listen to WebSocket Events

```typescript
import { useWebSocketEvents } from '../contexts/WebSocketContext';

function MyComponent() {
  // Automatically handles cleanup on unmount
  useWebSocketEvents((event) => {
    console.log('WebSocket event received:', event);
    
    if (event.type === 'StateMutation') {
      // Handle state mutation
      if (event.data?.events) {
        event.data.events.forEach(execEvent => {
          if (execEvent.kind === 'MessageReceived') {
            // Show notification for new message
          }
        });
      }
    }
  });
}
```

### 3. Example: Channel Notifications

```typescript
import { useWebSocketEvents } from '../contexts/WebSocketContext';
import { useToast } from '@calimero-network/mero-ui';

function ChannelNotifications() {
  const toast = useToast();
  
  useWebSocketEvents((event) => {
    if (event.data?.events) {
      event.data.events.forEach(execEvent => {
        if (execEvent.kind === 'MessageReceived') {
          const data = execEvent.data as any;
          toast.success(`New message from ${data.sender}`);
        }
      });
    }
  });
  
  return null; // This component just listens to events
}
```

## Benefits

### ✅ Before (Prop Drilling)
```typescript
Home → AppContainer → CurbNavbar → WebSocketStatus
           ↓ (passing props through every level)
```

### ✅ After (Context)
```typescript
WebSocketStatus: useWebSocket() ✓
Any Component: useWebSocket() ✓
```

### Key Advantages

1. **No Prop Drilling** - Any component can access WebSocket state
2. **Single Source of Truth** - One subscription manager for entire app
3. **Automatic Cleanup** - Event listeners cleaned up on unmount
4. **Type Safe** - Full TypeScript support
5. **Flexible** - Subscribe from anywhere, listen from anywhere

## Implementation Details

### Provider Location
- Located in: `app/src/contexts/WebSocketContext.tsx`
- Mounted in: `app/src/main.tsx` (inside CalimeroProvider)

### Subscription Management
- Uses `useMultiWebSocketSubscription` hook internally
- Maintains set of subscribed context IDs
- Distributes events to all registered listeners

### Event Distribution
- Event listeners are stored in a Set
- All listeners notified on each event
- Errors in one listener don't affect others
- Automatic cleanup on component unmount

## API Reference

### `useWebSocket()`
Returns WebSocket subscription manager.

```typescript
interface WebSocketContextValue {
  subscribeToContexts: (contextIds: string[]) => void;
  subscribeToContext: (contextId: string) => void;
  unsubscribeFromContext: (contextId: string) => void;
  unsubscribeAll: () => void;
  getSubscribedContexts: () => string[];
  isSubscribed: () => boolean;
  getSubscriptionCount: () => number;
  addEventListener: (listener: WebSocketEventListener) => void;
  removeEventListener: (listener: WebSocketEventListener) => void;
}
```

### `useWebSocketEvents(listener)`
Registers a WebSocket event listener. Automatically cleaned up on unmount.

```typescript
type WebSocketEventListener = (event: WebSocketEvent) => void;
```

## Migration Guide

### Old Way (Local Management)
```typescript
// In Home component
const subscription = useMultiWebSocketSubscription(app, eventCallbackFn);
subscription.subscribeToContexts(contextIds);

// Pass to child via props
<AppContainer wsIsSubscribed={subscription.isSubscribed()} />
```

### New Way (Global Context)
```typescript
// In Home component
const webSocket = useWebSocket();
webSocket.subscribeToContexts(contextIds);

// Access directly in any child
function AnyComponent() {
  const webSocket = useWebSocket();
  const isSubscribed = webSocket.isSubscribed();
}
```

## Example: Cross-Channel Notifications

With the global context, you can now implement features like:

```typescript
function BackgroundChannelNotifications() {
  const { channels } = useChannels();
  const { activeChat } = useActiveChat();
  const toast = useToast();
  
  useWebSocketEvents((event) => {
    if (event.data?.events) {
      event.data.events.forEach(execEvent => {
        if (execEvent.kind === 'MessageReceived') {
          const msgData = execEvent.data as any;
          
          // Find which channel this message is for
          const channel = channels.find(ch => 
            // Match by context or channel name logic
          );
          
          // Only notify if NOT the active channel
          if (channel && channel.name !== activeChat?.name) {
            toast.info(`New message in #${channel.name}`);
          }
        }
      });
    }
  });
  
  return null;
}
```

This enables:
- ✅ Notifications from any subscribed channel
- ✅ Badge counts for unread messages
- ✅ Real-time presence indicators
- ✅ Global event handlers

## Future Enhancements

Possible additions:
1. Event filtering by context ID
2. Event priority/debouncing
3. Offline event queueing
4. Event replay/history
5. WebSocket connection health exposed in context

