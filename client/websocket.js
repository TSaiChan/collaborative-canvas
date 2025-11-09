/**
 * WebSocketManager Class
 * 
 * Manages the WebSocket connection to the server.
 * 
 * Responsibilities:
 * - Connect to server
 * - Send drawing operations to server
 * - Receive messages from server
 * - Auto-reconnect if connection drops
 * - Handle connection state
 */
class WebSocketManager {
    constructor() {
        // The actual WebSocket connection object
        this.ws = null;

        // Is connection active?
        this.isConnected = false;

        // User's unique ID (assigned by server)
        this.userId = null;

        // Which room are we in?
        this.currentRoom = null;

        // User's display name
        this.username = null;

        // How many times have we tried to reconnect?
        this.reconnectAttempts = 0;

        // Don't try more than this many times
        this.maxReconnectAttempts = 5;

        // Wait this long between reconnect attempts (milliseconds)
        this.reconnectDelay = 3000; // 3 seconds

        // Map of message type → handler function
        // Used to route incoming messages
        this.messageHandlers = {};

        // Track operations that are pending/in-flight
        this.pendingOperations = new Map();
    }

    /**
     * Connect to the WebSocket server
     * 
     * Returns a Promise so caller can wait for connection to establish.
     * Automatically detects protocol (ws:// or wss://) based on current page
     * 
     * @returns {Promise} - Resolves when connected, rejects if fails
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                // Determine correct WebSocket protocol based on page protocol
                // If page is HTTPS, use WSS (secure WebSocket)
                // If page is HTTP, use WS (plain WebSocket)
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}`;

                console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

                // Create WebSocket connection
                this.ws = new WebSocket(wsUrl);

                /**
                 * Connection opened successfully
                 */
                this.ws.onopen = () => {
                    console.log('✓ WebSocket connected to server');
                    this.isConnected = true;

                    // Reset reconnection counter on successful connection
                    this.reconnectAttempts = 0;

                    // Emit event that we're connected
                    this.emit('CONNECTED');

                    // Resolve the promise
                    resolve();
                };

                /**
                 * Received a message from server
                 */
                this.ws.onmessage = (event) => {
                    try {
                        // Parse JSON message
                        const data = JSON.parse(event.data);

                        console.log(`📨 Received message: ${data.type}`);

                        // Route to appropriate handler
                        this.handleMessage(data);
                    } catch (error) {
                        console.error('Error parsing server message:', error);
                    }
                };

                /**
                 * WebSocket error occurred
                 */
                this.ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                    this.isConnected = false;
                    this.emit('CONNECTION_FAILED', error.message);
                    reject(new Error('WebSocket connection error'));
                };

                /**
                 * Connection closed
                 */
                this.ws.onclose = () => {
                    console.log('✗ WebSocket disconnected from server');
                    this.isConnected = false;
                    this.emit('DISCONNECTED');

                    // Try to reconnect
                    this.attemptReconnect();
                };

            } catch (error) {
                console.error('Error creating WebSocket:', error);
                this.emit('CONNECTION_FAILED', error.message);
                reject(error);
            }
        });
    }

    /**
     * Try to reconnect to server
     * 
     * Implements exponential backoff - waits longer between attempts.
     * Max 5 attempts with delays: 3s, 3s, 3s, 3s, 3s
     */
    attemptReconnect() {
        // Have we tried too many times?
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            // Increment attempt counter
            this.reconnectAttempts++;

            console.log(
                `🔄 Attempting reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
            );

            // Tell UI we're reconnecting
            this.emit('RECONNECTING', this.reconnectAttempts);

            // Wait a bit, then try connecting again
            setTimeout(() => {
                this.connect().catch(err => {
                    console.error('Reconnection failed:', err);
                    // Will trigger another attemptReconnect in onclose handler
                });
            }, this.reconnectDelay);

        } else {
            // Give up after max attempts
            console.error('❌ Max reconnection attempts reached');
            this.emit('CONNECTION_FAILED', 'Max reconnection attempts reached');
        }
    }

    /**
     * Send a message to the server
     * 
     * Checks if connection is open before sending.
     * 
     * @param {Object} data - Message object (will be JSON stringified)
     */
    send(data) {
        // Only send if connected
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(data));
                console.log(`📤 Sent: ${data.type}`);
            } catch (error) {
                console.error('Error sending message:', error);
            }
        } else {
            console.warn('⚠️  WebSocket not connected, message not sent:', data.type);
        }
    }

    /**
     * Join a drawing room
     * 
     * @param {string} roomId - Room to join
     * @param {string} username - Your display name
     */
    joinRoom(roomId = 'default', username = 'User') {
        this.currentRoom = roomId;
        this.username = username;

        console.log(`Joining room: "${roomId}" as "${username}"`);

        // Send join request to server
        this.send({
            type: 'JOIN_ROOM',
            roomId,
            username
        });
    }

    /**
     * Send a drawing operation to server
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     * @param {string} color - Hex color
     * @param {number} size - Brush size
     * @param {string} userId - Your user ID
     */
    sendDraw(x0, y0, x1, y1, color, size, userId) {
        const timestamp = Date.now();
        const operationId = this.generateOperationId();

        // Send to server
        this.send({
            type: 'DRAW',
            userId,
            x0: Math.round(x0),
            y0: Math.round(y0),
            x1: Math.round(x1),
            y1: Math.round(y1),
            color,
            size,
            timestamp,
            operationId
        });

        // Track this operation
        this.trackOperation(operationId, 'DRAW');
    }

    /**
     * Send an erase operation to server
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     * @param {number} size - Eraser size
     * @param {string} userId - Your user ID
     */
    sendErase(x0, y0, x1, y1, size, userId) {
        const timestamp = Date.now();
        const operationId = this.generateOperationId();

        this.send({
            type: 'ERASE',
            userId,
            x0: Math.round(x0),
            y0: Math.round(y0),
            x1: Math.round(x1),
            y1: Math.round(y1),
            size,
            timestamp,
            operationId
        });

        this.trackOperation(operationId, 'ERASE');
    }

    /**
     * Send undo request to server
     * 
     * @param {string} userId - Your user ID
     * @param {string} operationId - Operation to undo
     */
    sendUndo(userId, operationId) {
        const timestamp = Date.now();
        this.send({
            type: 'UNDO',
            userId,
            operationId,
            timestamp
        });
    }

    /**
     * Send redo request to server
     * 
     * @param {string} userId - Your user ID
     * @param {string} operationId - Operation to redo
     */
    sendRedo(userId, operationId) {
        const timestamp = Date.now();
        this.send({
            type: 'REDO',
            userId,
            operationId,
            timestamp
        });
    }

    /**
     * Tell server to clear the canvas
     * 
     * @param {string} userId - Your user ID
     */
    sendClearCanvas(userId) {
        const timestamp = Date.now();
        this.send({
            type: 'CLEAR_CANVAS',
            userId,
            timestamp
        });
    }

    /**
     * Send cursor position to other users
     * 
     * Throttled so we don't send too many messages.
     * 
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     */
    sendCursorPosition(x, y) {
        this.send({
            type: 'CURSOR_MOVE',
            x: Math.round(x),
            y: Math.round(y)
        });
    }

    /**
     * Route incoming message to appropriate handler
     * 
     * @param {Object} data - Message from server
     */
    handleMessage(data) {
        // Look up handler for this message type
        const handler = this.messageHandlers[data.type];

        if (handler) {
            // Call the handler function
            try {
                handler(data);
            } catch (error) {
                console.error(`Error in handler for ${data.type}:`, error);
            }
        } else {
            // No specific handler, emit as generic event
            this.emit(data.type, data);
        }
    }

    /**
     * Register a handler for a specific message type
     * 
     * @param {string} eventType - Message type to listen for
     * @param {Function} handler - Function to call when received
     */
    on(eventType, handler) {
        this.messageHandlers[eventType] = handler;
    }

    /**
     * Emit a custom event
     * 
     * Used to notify UI of important events.
     * 
     * @param {string} eventType - Event type
     * @param {Object} data - Event data
     */
    emit(eventType, data = {}) {
        // Create custom event
        const event = new CustomEvent('ws-event', {
            detail: { type: eventType, data }
        });

        // Dispatch it so window listeners can receive it
        window.dispatchEvent(event);
    }

    /**
     * Track an operation we sent
     * 
     * Used for debugging/monitoring.
     * 
     * @param {string} operationId - Operation ID
     * @param {string} type - Operation type
     */
    trackOperation(operationId, type) {
        this.pendingOperations.set(operationId, {
            type,
            timestamp: Date.now()
        });

        // Clean up old operations after 30 seconds
        setTimeout(() => {
            this.pendingOperations.delete(operationId);
        }, 30000);
    }

    /**
     * Generate a unique operation ID
     * 
     * Combines timestamp with random string for uniqueness.
     * 
     * @returns {string} - Unique ID
     */
    generateOperationId() {
        // Format: "op-{timestamp}-{random}"
        return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.isConnected = false;
            console.log('Disconnected from WebSocket');
        }
    }

    /**
     * Is the WebSocket ready to send/receive?
     * 
     * @returns {boolean} - True if connected and open
     */
    isReady() {
        return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}