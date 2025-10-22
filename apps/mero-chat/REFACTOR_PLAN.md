# Calimero Chat - Comprehensive Refactor Plan

## 🎯 Goals
1. **Simplify** - Reduce complexity and cognitive load
2. **Smooth** - Eliminate jank, improve performance
3. **Maintainable** - Make code easier to understand and modify
4. **Scalable** - Prepare for future feature additions

## 📊 Current State Analysis

### File Size Metrics
- **utils/emoji.ts**: 7,351 lines ⚠️ (extremely large, likely auto-generated)
- **api/dataSource/clientApiDataSource.ts**: 1,421 lines ⚠️ (needs splitting)
- **pages/Home/index.tsx**: 1,008 lines ⚠️ (God component anti-pattern)
- **chat/MessageInput.tsx**: 687 lines ⚠️ (should be smaller)
- **chat/ChatContainer.tsx**: 489 lines (moderate, could be better)

### Key Issues Identified

#### 🔴 Critical Issues

1. **God Component - Home/index.tsx (1,008 lines)**
   - **Problem**: Single component managing ALL state and logic
   - Manages: messages, channels, DMs, subscriptions, users, threads, sounds
   - Contains: 15+ state variables, 10+ useCallback functions, 5+ useEffect hooks
   - **Impact**: Hard to maintain, test, and debug; prone to bugs

2. **Duplicate Message Mapping (4+ occurrences)**
   - **Problem**: Same message transformation logic repeated in:
     - `loadInitialChatMessages`
     - `handleMessageUpdates`
     - `loadPrevMessages`
     - `loadPrevThreadMessages`
   - **Impact**: Maintenance nightmare, inconsistency risk

3. **Prop Drilling (5+ levels deep)**
   - **Problem**: Props passed through multiple components:
     - `AppContainer` → `ChatContainer` → `ChatDisplaySplit` → VirtualizedChat
   - **Impact**: Tight coupling, hard to refactor

4. **Missing Separation of Concerns**
   - **Problem**: UI, business logic, and data fetching mixed together
   - **Impact**: Hard to test, hard to reuse logic

#### 🟡 Moderate Issues

5. **Duplicate Scrollbar Styling**
   - **Problem**: Same scrollbar CSS repeated in 3+ components
   - **Impact**: Maintenance overhead, inconsistency

6. **Complex DM State Management**
   - **Problem**: 7 different DM states managed procedurally
   - **Impact**: Hard to understand flow, prone to edge cases

7. **No Custom Hooks for Reusable Logic**
   - **Problem**: Message operations, channel operations mixed in components
   - **Impact**: Can't reuse logic, hard to test

8. **Inconsistent Error Handling**
   - **Problem**: Some errors logged, some ignored, some thrown
   - **Impact**: Hard to debug production issues

#### 🟢 Minor Issues

9. **Magic Numbers**
   - **Problem**: Hardcoded values (20, 50, 100, 300, 1000, etc.)
   - **Impact**: Hard to maintain, unclear intent

10. **TypeScript any usage**
    - **Problem**: Multiple `any` types reducing type safety
    - **Impact**: Loses TypeScript benefits

---

## 🔧 Refactor Plan

### Phase 1: Foundation & Utilities (Low Risk, High Value)

#### 1.1 Extract Message Transformation Logic
**Priority**: HIGH  
**Effort**: 2 hours  
**Risk**: LOW

Create `utils/messageTransformers.ts`:
```typescript
export function transformMessageToUI(message: MessageWithReactions): CurbMessage {
  return {
    id: message.id,
    text: message.text,
    nonce: Math.random().toString(36).substring(2, 15),
    key: message.id,
    timestamp: message.timestamp * 1000,
    sender: message.sender,
    senderUsername: message.sender_username,
    reactions: message.reactions,
    threadCount: message.thread_count,
    threadLastTimestamp: message.thread_last_timestamp,
    editedOn: message.edited_on,
    mentions: [],
    files: [],
    images: [],
    editMode: false,
    status: MessageStatus.sent,
    deleted: message.deleted,
  };
}

export function transformMessagesToUI(messages: MessageWithReactions[]): CurbMessage[] {
  return messages.map(transformMessageToUI);
}
```

**Benefits**:
- Eliminates 4+ duplicate implementations
- Single source of truth
- Easy to add new fields
- Testable in isolation

#### 1.2 Create Constants File
**Priority**: MEDIUM  
**Effort**: 30 minutes  
**Risk**: LOW

Create `constants/app.ts`:
```typescript
export const MESSAGE_PAGE_SIZE = 20;
export const RECENT_MESSAGES_CHECK_SIZE = 5;
export const DEBOUNCE_DELAY_MS = 1000;
export const EVENT_RATE_LIMIT_MS = 100;
export const PERSISTENT_STATE_POLL_MS = 500;
export const IDLE_TIMEOUT_MS = 3600000; // 1 hour
export const SUBSCRIPTION_INIT_DELAY_MS = 500;
```

**Benefits**:
- No more magic numbers
- Easy to tune performance
- Self-documenting

#### 1.3 Create Shared Styles
**Priority**: MEDIUM  
**Effort**: 1 hour  
**Risk**: LOW

Create `styles/scrollbar.ts`:
```typescript
import { css } from 'styled-components';

export const scrollbarStyles = css`
  scrollbar-color: black black;
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
`;
```

**Benefits**:
- DRY principle
- Consistent styling
- Easy to update globally

---

### Phase 2: Custom Hooks (Medium Risk, High Value)

#### 2.1 Create `useMessages` Hook
**Priority**: HIGH  
**Effort**: 4 hours  
**Risk**: MEDIUM

Extract all message-related logic from Home/index.tsx:

```typescript
// hooks/useMessages.ts
export function useMessages(activeChat: ActiveChat | null) {
  const [messages, setMessages] = useState<CurbMessage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(MESSAGE_PAGE_SIZE);
  const messagesRef = useRef<CurbMessage[]>([]);

  const loadInitial = useCallback(async () => {
    // Load initial messages logic
  }, [activeChat]);

  const loadPrevious = useCallback(async () => {
    // Load previous messages logic
  }, [activeChat, offset]);

  const addIncoming = useCallback((newMessages: CurbMessage[]) => {
    // Add incoming messages logic
  }, []);

  return {
    messages,
    totalCount,
    loadInitial,
    loadPrevious,
    addIncoming,
    clearMessages: () => {
      setMessages([]);
      messagesRef.current = [];
    }
  };
}
```

**Benefits**:
- Reduces Home component by ~300 lines
- Reusable across components
- Easier to test
- Clear message management API

#### 2.2 Create `useChannels` Hook
**Priority**: HIGH  
**Effort**: 3 hours  
**Risk**: MEDIUM

```typescript
// hooks/useChannels.ts
export function useChannels() {
  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    const result = await new ClientApiDataSource().getChannels();
    if (result.data) {
      setChannels(transformChannels(result.data));
    }
    setLoading(false);
  }, []);

  const debouncedFetch = useMemo(
    () => debounce(fetch, DEBOUNCE_DELAY_MS),
    [fetch]
  );

  return { channels, loading, fetch, debouncedFetch };
}
```

**Benefits**:
- Separates channel logic
- Reusable
- Clear API

#### 2.3 Create `useWebSocketSubscription` Hook
**Priority**: HIGH  
**Effort**: 3 hours  
**Risk**: MEDIUM

```typescript
// hooks/useWebSocketSubscription.ts
export function useWebSocketSubscription(
  app: CalimeroApp,
  contextId: string,
  onEvent: (event: any) => void
) {
  const subscriptionRef = useRef<string>("");
  const eventCallbackRef = useRef(onEvent);

  useEffect(() => {
    eventCallbackRef.current = onEvent;
  }, [onEvent]);

  const subscribe = useCallback((newContextId: string) => {
    // Subscription logic with cleanup
  }, [app]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
    };
  }, [app]);

  return { subscribe };
}
```

**Benefits**:
- Encapsulates subscription complexity
- Automatic cleanup
- Reusable

#### 2.4 Create `useDMs` Hook
**Priority**: MEDIUM  
**Effort**: 3 hours  
**Risk**: MEDIUM

```typescript
// hooks/useDMs.ts
export function useDMs() {
  const [dms, setDms] = useState<DMChatInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    // Fetch DMs logic
  }, []);

  const create = useCallback(async (userId: string) => {
    // Create DM logic
  }, []);

  return { dms, loading, fetch, create };
}
```

---

### Phase 3: Component Refactoring (High Risk, High Value)

#### 3.1 Split Home/index.tsx
**Priority**: HIGH  
**Effort**: 8 hours  
**Risk**: HIGH

**Current Structure** (1,008 lines):
```
Home/index.tsx
├── All state (15+ variables)
├── All event handlers
├── Message management
├── Channel management
├── DM management
├── Subscription management
└── Rendering
```

**Proposed Structure**:
```
pages/Home/
├── index.tsx (150 lines) - Main orchestrator
├── hooks/
│   ├── useHomeState.ts - Centralized state
│   ├── useMessageHandlers.ts - Message event handlers
│   └── useChannelHandlers.ts - Channel event handlers
├── components/
│   ├── ChatManager.tsx - Manages chat display logic
│   └── SubscriptionManager.tsx - Handles websocket subscriptions
└── utils/
    └── chatHelpers.ts - Helper functions
```

**New Home/index.tsx** (simplified):
```typescript
export default function Home({ isConfigSet }: { isConfigSet: boolean }) {
  const { app } = useCalimero();
  
  // Custom hooks handle everything
  const messages = useMessages(activeChat);
  const channels = useChannels();
  const dms = useDMs();
  const subscription = useWebSocketSubscription(app, contextId, handleEvent);
  
  return (
    <AppContainer
      messages={messages}
      channels={channels}
      dms={dms}
      // Much cleaner props
    />
  );
}
```

**Benefits**:
- 85% reduction in component size
- Clear separation of concerns
- Much easier to understand
- Easier to test
- Easier to debug

#### 3.2 Refactor ChatContainer
**Priority**: MEDIUM  
**Effort**: 4 hours  
**Risk**: MEDIUM

**Split into**:
- `ChatContainer.tsx` - Routing logic (DM states, channel states)
- `ChatDisplay.tsx` - Actual chat display (messages, input)
- `DMStateHandler.tsx` - Handle different DM states

**Benefits**:
- Single responsibility per component
- Easier to understand DM flow
- Reusable ChatDisplay

#### 3.3 Extract Message Operations Service
**Priority**: MEDIUM  
**Effort**: 3 hours  
**Risk**: LOW

Create `services/MessageService.ts`:
```typescript
export class MessageService {
  private api = new ClientApiDataSource();

  async send(params: SendMessageParams): Promise<Result<Message>> {
    // Send logic
  }

  async edit(params: EditMessageParams): Promise<Result<Message>> {
    // Edit logic
  }

  async delete(messageId: string): Promise<Result<void>> {
    // Delete logic
  }

  async react(messageId: string, emoji: string): Promise<Result<void>> {
    // React logic
  }
}
```

**Benefits**:
- Testable business logic
- Reusable across components
- Clear API boundaries

---

### Phase 4: State Management (High Risk, Very High Value)

#### 4.1 Implement Zustand Store
**Priority**: HIGH  
**Effort**: 6 hours  
**Risk**: HIGH

**Current**: Props drilling 5+ levels deep  
**Proposed**: Centralized state management

```typescript
// store/chatStore.ts
import create from 'zustand';

interface ChatStore {
  // State
  activeChat: ActiveChat | null;
  messages: CurbMessage[];
  channels: ChannelMeta[];
  dms: DMChatInfo[];
  
  // Actions
  setActiveChat: (chat: ActiveChat) => void;
  addMessage: (message: CurbMessage) => void;
  updateChannels: (channels: ChannelMeta[]) => void;
  
  // Selectors
  getCurrentMessages: () => CurbMessage[];
  getUnreadCount: () => number;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  activeChat: null,
  messages: [],
  channels: [],
  dms: [],
  
  setActiveChat: (chat) => set({ activeChat: chat }),
  addMessage: (message) => set(state => ({ 
    messages: [...state.messages, message] 
  })),
  // ... other actions
  
  getCurrentMessages: () => get().messages,
  getUnreadCount: () => {
    // Calculate unread count
  },
}));
```

**Benefits**:
- **Eliminates prop drilling** completely
- Components access only what they need
- Automatic re-renders when relevant state changes
- DevTools for debugging
- Much simpler component code

**Migration**:
1. Create store with current state
2. Migrate one component at a time
3. Remove props as you go
4. Test thoroughly

---

### Phase 5: Performance Optimizations

#### 5.1 Memoize Components
**Priority**: MEDIUM  
**Effort**: 3 hours  
**Risk**: LOW

Wrap expensive components in `React.memo`:
- `ChannelList` - Only re-render when channels change
- `MessageRenderer` - Only re-render when message changes
- `SideSelector` - Only re-render when selection changes

```typescript
export const ChannelList = React.memo(({ channels, onSelect }) => {
  // Component logic
}, (prevProps, nextProps) => {
  return prevProps.channels === nextProps.channels &&
         prevProps.selectedId === nextProps.selectedId;
});
```

**Benefits**:
- Fewer unnecessary re-renders
- Smoother UI
- Better performance

#### 5.2 Optimize Message List Rendering
**Priority**: MEDIUM  
**Effort**: 2 hours  
**Risk**: LOW

**Already using**: `curb-virtualized-chat` ✅  
**Optimization**: Ensure proper key usage and memoization

**Benefits**:
- Smooth scrolling
- Handles thousands of messages efficiently

#### 5.3 Implement Request Batching
**Priority**: LOW  
**Effort**: 4 hours  
**Risk**: MEDIUM

Batch multiple API calls together:
```typescript
// Instead of:
await fetchChannels();
await fetchDMs();
await fetchMembers();

// Do:
await Promise.all([
  fetchChannels(),
  fetchDMs(),
  fetchMembers()
]);
```

**Benefits**:
- Faster data loading
- Better perceived performance

---

### Phase 6: Code Quality Improvements

#### 6.1 Add Comprehensive Error Boundaries
**Priority**: MEDIUM  
**Effort**: 2 hours  
**Risk**: LOW

```typescript
// components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component {
  // Catch errors in component tree
  // Show fallback UI
  // Log to monitoring service
}
```

**Benefits**:
- Better error handling
- Prevents full app crashes
- Better UX

#### 6.2 Standardize API Response Handling
**Priority**: MEDIUM  
**Effort**: 3 hours  
**Risk**: LOW

Create utility for consistent error handling:
```typescript
// utils/apiHelpers.ts
export async function handleApiCall<T>(
  apiCall: () => Promise<ApiResponse<T>>,
  options?: { onError?: (error: ApiError) => void }
): Promise<T | null> {
  try {
    const response = await apiCall();
    if (response.error) {
      options?.onError?.(response.error);
      return null;
    }
    return response.data;
  } catch (error) {
    console.error('API call failed:', error);
    options?.onError?.(/* formatted error */);
    return null;
  }
}
```

**Benefits**:
- Consistent error handling
- Less boilerplate
- Better error messages

#### 6.3 Remove Dead Code & Comments
**Priority**: LOW  
**Effort**: 1 hour  
**Risk**: LOW

- Remove commented-out thread code in `ChatContainer.tsx`
- Remove unused imports
- Remove TODO comments without context

---

## 📅 Implementation Roadmap

### Sprint 1: Quick Wins (1 week)
- [ ] Extract message transformers (1.1)
- [ ] Create constants file (1.2)
- [ ] Create shared scrollbar styles (1.3)
- [ ] Memoize components (5.1)
- [ ] Remove dead code (6.3)

**Expected Impact**: 20% performance improvement, cleaner code

### Sprint 2: Custom Hooks (2 weeks)
- [ ] Create useMessages hook (2.1)
- [ ] Create useChannels hook (2.2)
- [ ] Create useDMs hook (2.4)
- [ ] Create useWebSocketSubscription hook (2.3)

**Expected Impact**: 40% reduction in component complexity

### Sprint 3: Zustand Migration (2 weeks)
- [ ] Set up Zustand store (4.1)
- [ ] Migrate messages state
- [ ] Migrate channels state
- [ ] Migrate DMs state
- [ ] Remove props drilling

**Expected Impact**: 60% reduction in prop drilling, much simpler component tree

### Sprint 4: Component Refactoring (3 weeks)
- [ ] Split Home/index.tsx (3.1)
- [ ] Refactor ChatContainer (3.2)
- [ ] Extract MessageService (3.3)
- [ ] Add error boundaries (6.1)
- [ ] Standardize API handling (6.2)

**Expected Impact**: 70% easier to maintain, much easier to add features

### Sprint 5: Final Polish (1 week)
- [ ] Performance profiling
- [ ] Fix any remaining issues
- [ ] Documentation
- [ ] Testing

---

## 🎁 Expected Benefits After Full Refactor

### Code Quality
- **85% reduction** in Home component size (1000 → 150 lines)
- **Zero prop drilling** (use Zustand instead)
- **Reusable logic** via custom hooks
- **Type-safe** throughout (remove all `any`)

### Performance
- **30-40% faster** initial load (request batching)
- **Smoother scrolling** (proper memoization)
- **Less CPU usage** (optimized hooks, fewer re-renders)
- **Better memory management** (proper cleanup)

### Developer Experience
- **10x easier** to understand codebase
- **5x easier** to add new features
- **Easy to test** (isolated hooks and services)
- **Easy to debug** (clear separation of concerns)

### User Experience
- **Instant** channel/DM switching
- **Smooth** scrolling (no jank)
- **Responsive** UI (no lag)
- **Reliable** (better error handling)

---

## 🚨 Migration Risks & Mitigation

### High Risk Items
1. **Home/index.tsx refactor**
   - **Risk**: Breaking existing functionality
   - **Mitigation**: 
     - Do incrementally
     - Test each step
     - Keep old code as comments initially
     - Use feature flags

2. **Zustand migration**
   - **Risk**: State sync issues
   - **Mitigation**:
     - Migrate one state slice at a time
     - Run both systems in parallel temporarily
     - Comprehensive testing

### Medium Risk Items
3. **Custom hooks extraction**
   - **Risk**: Dependency issues, re-render loops
   - **Mitigation**:
     - Use refs where appropriate
     - Careful dependency management
     - Performance profiling

---

## 🔍 Immediate Quick Wins (Can Do Now)

These are **low risk, high value** improvements you can make immediately:

### 1. Extract Message Transformer (30 minutes)
```typescript
// utils/messageTransformers.ts - CREATE THIS FILE
```

### 2. Create Constants (15 minutes)
```typescript
// constants/app.ts - CREATE THIS FILE
```

### 3. Memoize ChannelList (10 minutes)
```typescript
export default React.memo(ChannelList);
```

### 4. Batch API Calls in fetchInitialData (5 minutes)
```typescript
await Promise.all([fetchChannels(), fetchDMs(), fetchMembers()]);
```

### 5. Remove Duplicate updateSelectedActiveChat Call (ALREADY DONE ✅)

---

## 🎯 Recommended Next Steps

### Option A: Incremental (Lower Risk)
Start with Phase 1 & 2, then assess before continuing
- **Timeline**: 2-3 weeks for significant improvement
- **Risk**: LOW
- **Benefit**: Moderate

### Option B: Comprehensive (Higher Risk, Higher Reward)
Do full refactor following all phases
- **Timeline**: 2-3 months
- **Risk**: MEDIUM-HIGH
- **Benefit**: TRANSFORMATIVE

### Option C: Hybrid (Recommended)
1. Do Phase 1 (quick wins) immediately
2. Do Phase 2 (custom hooks) next
3. Assess if Phase 3-4 needed based on complexity
- **Timeline**: 1 month for major improvements
- **Risk**: MEDIUM
- **Benefit**: HIGH

---

## 📝 Notes

- Current websocket optimizations ALREADY done ✅
- Context switching feature ALREADY added ✅
- Auth headers ALREADY fixed ✅
- Scroll performance PARTIALLY improved ✅

The main pain points remaining are:
1. Overly complex Home component (1000 lines)
2. Duplicate code (message mapping)
3. Prop drilling (5+ levels)
4. Mixed concerns (UI + business logic + data)

**Bottom Line**: A refactor would significantly improve maintainability and performance, but can be done incrementally to manage risk.

