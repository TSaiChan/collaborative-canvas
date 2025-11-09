# 🏗️ Collaborative Drawing Canvas - Architecture Documentation

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Clients                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   User 1     │  │   User 2     │  │   User N     │      │
│  │  Canvas App  │  │  Canvas App  │  │  Canvas App  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │ (WebSocket)
                             ↓
        ┌────────────────────────────────────┐
        │    Node.js Server + WebSocket      │
        │  ┌──────────────────────────────┐  │
        │  │   Room Manager               │  │
        │  │  ┌────────────────────────┐  │  │
        │  │  │  Room 1  (default)     │  │  │
        │  │  │  - Clients             │  │  │
        │  │  │  - Drawing History     │  │  │
        │  │  │  - Operation History   │  │  │
        │  │  └────────────────────────┘  │  │
        │  │  ┌────────────────────────┐  │  │
        │  │  │  Room 2  (other)       │  │  │
        │  │  │  - Clients             │  │  │
        │  │  │  - Drawing History     │  │  │
        │  │  └────────────────────────┘  │  │
        │  └──────────────────────────────┘  │
        └────────────────────────────────────┘
```

## 2. Data Flow Diagram

### Drawing Operation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL USER DRAWING                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
                   Mouse Down/Move Events
                          ↓
        ┌─────────────────────────────────┐
        │   Canvas Drawing Logic          │
        │ - Calculate stroke path         │
        │ - Apply color & size            │
        │ - Update local canvas           │
        └─────────────────────────────────┘
                          ↓
                   Save to Local History
                          ↓
        ┌─────────────────────────────────┐
        │  WebSocket Manager              │
        │  Send: {                        │
        │    type: 'DRAW'                 │
        │    x0, y0, x1, y1               │
        │    color, size                  │
        │    userId, timestamp            │
        │  }                              │
        └─────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────┐
        │   Server Receives               │
        │ - Store in drawing history      │
        │ - Validate user & room          │
        └─────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────┐
        │  Broadcast to Room              │
        │  (All users except sender)      │
        └─────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────┐
        │   Remote Users Receive          │
        │ - Update their canvas           │
        │ - Apply same stroke             │
        │ - NO history (server manages)   │
        └─────────────────────────────────┘
```

## 3. WebSocket Protocol

### Message Format

All messages follow this JSON structure:

```javascript
{
  type: 'MESSAGE_TYPE',
  userId: 'user-id-123',
  timestamp: 1699999999999,
  // ... type-specific fields
}
```

### Message Types

#### 1. JOIN_ROOM
**Client → Server**
```javascript
{
  type: 'JOIN_ROOM',
  roomId: 'default',
  username: 'Alice'
}
```

**Server Response (to all users):**
```javascript
{
  type: 'LOAD_HISTORY',
  drawingHistory: [...],
  operationHistory: [...],
  userInfo: {
    userId: 'user-123',
    username: 'Alice',
    color: '#FF6B6B'
  }
}
```

#### 2. DRAW
**Client → Server → Other Clients**
```javascript
{
  type: 'DRAW',
  userId: 'user-123',
  x0: 100,      // Starting X
  y0: 50,       // Starting Y
  x1: 105,      // Ending X
  y1: 55,       // Ending Y
  color: '#000000',
  size: 3,
  timestamp: 1699999999999,
  operationId: 'op-1699999999-abc123'
}
```

#### 3. ERASE
**Client → Server → Other Clients**
```javascript
{
  type: 'ERASE',
  userId: 'user-123',
  x0: 100,
  y0: 50,
  x1: 105,
  y1: 55,
  size: 20,
  timestamp: 1699999999999,
  operationId: 'op-1699999999-def456'
}
```

#### 4. UNDO/REDO
**Client → Server → Other Clients**
```javascript
{
  type: 'UNDO',
  userId: 'user-123',
  operationId: 'op-1699999999-abc123',
  timestamp: 1699999999999
}
```

#### 5. CLEAR_CANVAS
**Client → Server → Other Clients**
```javascript
{
  type: 'CLEAR_CANVAS',
  userId: 'user-123',
  timestamp: 1699999999999
}
```

#### 6. CURSOR_MOVE
**Client → Server → Other Clients (throttled)**
```javascript
{
  type: 'CURSOR_MOVE',
  userId: 'user-123',
  x: 150,
  y: 75
}
```

#### 7. USER_JOINED / USER_LEFT
**Server → All Clients**
```javascript
{
  type: 'USER_JOINED',
  users: [
    {
      userId: 'user-123',
      username: 'Alice',
      color: '#FF6B6B'
    },
    {
      userId: 'user-456',
      username: 'Bob',
      color: '#4ECDC4'
    }
  ],
  clientCount: 2
}
```

## 4. Undo/Redo Strategy

### Local Undo/Redo Implementation

```
Canvas States Stack:
┌──────────────────┐
│ State 5 (Latest) │  ← currentStateIndex = 4
├──────────────────┤
│ State 4          │
├──────────────────┤
│ State 3 (Undo)   │  ← After undo, index = 2
├──────────────────┤
│ State 2          │
├──────────────────┤
│ State 1 (Initial)│
└──────────────────┘

Maximum history: 50 states
When exceeded: Remove oldest state
```

### Global Undo/Redo Handling

**Problem:** User A draws, User B draws, User A undoes.
What happens to User B's drawing?

**Solution:** 
1. Each operation is timestamped
2. Undo removes the specific operation from history
3. Canvas is rebuilt from remaining operations
4. All users stay in sync through server

**Example Scenario:**
```
Timeline:
t=0  User A: Draw circle
t=1  User B: Draw square
t=2  User A: UNDO (removes circle)
     → Both users see only the square

Server Action:
- Receives UNDO from User A
- Removes that operation from drawingHistory
- Broadcasts to all users
- All users rebuild canvas from updated history
```

### Implementation Details

```javascript
// Server maintains:
drawingHistory = [
  { op_id: 1, userId: 'A', type: 'DRAW', ... },
  { op_id: 2, userId: 'B', type: 'DRAW', ... },
  { op_id: 3, userId: 'A', type: 'DRAW', ... }
]

// When UNDO arrives:
drawingHistory = drawingHistory.filter(op => op.op_id !== 1)

// New user joining receives updated history:
LOAD_HISTORY { drawingHistory: [ op_2, op_3 ] }
```

## 5. Conflict Resolution Strategy

### Last-Write-Wins (LWW)

When multiple users draw in overlapping areas:

```
User A draws pixel at (100, 100) at t=1000
User B draws pixel at (100, 100) at t=1001

Result: User B's pixel remains (LWW)
All users see User B's drawing because it's more recent
```

### Implementation

```javascript
// Server receives both messages
// Timestamps ensure consistent ordering

message1 = { type: 'DRAW', x: 100, y: 100, timestamp: 1000 }
message2 = { type: 'DRAW', x: 100, y: 100, timestamp: 1001 }

// Both are added to history in timestamp order:
drawingHistory = [message1, message2]

// When rendering, message2 is drawn last (on top)
```

### No Rollback

- Once an operation is committed, it stays (no rollback)
- Undo is handled by the user who drew
- Other users don't experience rollback
- All operations are final

## 6. Performance Optimizations

### 1. Stroke Batching

```
Without batching:
Draw stroke → Send 100 messages (1 per pixel)
Network: 100 messages

With optimization:
Draw stroke → Draw on canvas → Send 1 message with (x0, y0, x1, y1)
Network: 1 message
Result: 100x reduction in traffic
```

### 2. Coordinate Rounding

```javascript
// Before: 123.456789
// After:  123 (rounded to integer)
// Benefit: Reduces precision, saves bytes
```

### 3. Cursor Throttling

```
Mouse move events: ~1000 per second
Without throttling: Send 1000 messages/sec
With 20ms throttle: Send ~50 messages/sec

Result: 20x reduction in cursor update traffic
```

### 4. History Pruning

```javascript
// Keep max 50 states
// When user takes many actions, oldest are removed
// Benefits: Memory efficiency, faster undo/redo

Memory impact:
- 50 canvas snapshots × 500KB = 25MB max
- Acceptable on modern browsers
```

### 5. Lazy Loading

```
New user joins → Server sends only operations
NOT full image dumps
→ Faster connection
→ New user builds canvas by replaying operations
```

## 7. State Management

### Server-Side State

```javascript
class Room {
  id: 'room-id'
  clients: Set<WebSocket>
  drawingHistory: Array<Operation>
  operationHistory: Array<Operation>
  userMap: Map<WebSocket, UserInfo>
}
```

### Client-Side State

```javascript
class CanvasManager {
  canvas: HTMLCanvasElement
  drawingStates: Array<ImageData>  // For undo/redo
  currentStateIndex: number
  currentColor: string
  brushSize: number
}

class WebSocketManager {
  ws: WebSocket
  isConnected: boolean
  userId: string
  currentRoom: string
  pendingOperations: Map
}
```

## 8. Scalability Considerations

### Current Design (Single Server)

**Handles:**
- ✅ 50-100 concurrent users
- ✅ Small rooms (< 10 people)
- ✅ Single machine deployment

**Limitations:**
- ❌ No persistence (data lost on restart)
- ❌ All data in memory
- ❌ Single point of failure
- ❌ Limited by server resources

### Scaling to 1000+ Users

Would require:

1. **Database Layer**
   - Store drawing operations in MongoDB/PostgreSQL
   - Persist canvas state

2. **Message Queue**
   - Redis/RabbitMQ for operation streaming
   - Decouple server from clients

3. **Load Balancing**
   - Multiple server instances
   - Nginx/HAProxy to distribute connections

4. **Horizontal Scaling**
   - Room sharding across servers
   - Server clusters

5. **CDN Integration**
   - Cache static assets
   - Reduce server load

## 9. Error Handling

### Network Failures

```javascript
// Client detection
ws.onclose → DISCONNECTED state
ws.onerror → ERROR state

// Auto-reconnect
Attempt 1: 3s delay
Attempt 2: 3s delay
Attempt 3: 3s delay
Attempt 4: 3s delay
Attempt 5: 3s delay
Max attempts: 5 → Connection Failed
```

### Invalid Messages

```javascript
// Server validates
if (!data.userId || !data.type) {
  console.error('Invalid message')
  // Silently ignore or respond with error
}
```

### Canvas Desynchronization

**Prevention:**
- New users load full history
- Operations are deterministic
- Timestamps enforce ordering

**Recovery:**
- User can refresh page
- Rejoins room
- Receives current state

## 10. Testing Strategy

### Unit Testing

```javascript
// Test canvas operations
draw(10, 20, 30, 40) → verify stroke drawn
erase(10, 20, 30, 40) → verify area cleared
undo() → verify state restored
redo() → verify state reapplied
```

### Integration Testing

```javascript
// Simulate multi-user scenario
1. Create 2 rooms
2. Connect 3 users to Room A
3. User 1 draws
4. User 2 verifies drawing received
5. User 3 performs undo
6. Verify all users see updated state
```

### Load Testing

```
Simulate 100 concurrent users
Each drawing continuously
Measure:
- CPU usage
- Memory usage
- Message latency
- Canvas responsiveness
```

## 11. Security Considerations

### Current Implementation (Minimal Security)

✅ **Provided:**
- User IDs prevent most conflicts
- Operations timestamped

❌ **Missing:**
- User authentication
- Authorization (any user can access any room)
- Input validation
- Rate limiting
- HTTPS/WSS encryption

### Production Hardening Would Include

1. **Authentication**
   - JWT tokens
   - Session management

2. **Authorization**
   - User roles/permissions
   - Room access control

3. **Input Validation**
   - Sanitize all inputs
   - Type checking

4. **Rate Limiting**
   - Max operations per user per second
   - Prevent abuse

5. **Encryption**
   - WSS (WebSocket Secure)
   - HTTPS only

## 12. Deployment Checklist

- [ ] Set NODE_ENV=production
- [ ] Enable compression
- [ ] Set up error logging
- [ ] Configure rate limiting
- [ ] Use WSS (secure WebSocket)
- [ ] Set up database backups
- [ ] Monitor server resources
- [ ] Implement user authentication
- [ ] Add input validation
- [ ] Set up load balancing

---

**Architecture designed for clarity and maintainability, not production scale.**