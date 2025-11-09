const { v4: uuidv4 } = require('uuid');
const DrawingState = require('./drawing-state');

// Color palette for user identification
// Each user gets one of these colors when they join
const USER_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
    '#F8B88B', '#A8D8EA', '#AA96DA', '#FCBAD3'
];

/**
 * DrawingRoom Class
 * 
 * Represents one drawing session/room.
 * 
 * Think of it like a physical room:
 * - Multiple people can enter the room (clients)
 * - Everyone sees the same whiteboard (drawingState)
 * - When someone draws, everyone sees it
 * - When someone leaves, the room continues
 * - When empty for too long, the room gets cleaned up
 */
class DrawingRoom {
    constructor(roomId) {
        // Unique identifier for this room
        // Examples: "default", "room-1", "team-project"
        this.id = roomId;

        // Map of all connected clients (WebSocket connections)
        // Key: WebSocket object
        // Value: Client info (userId, username, color, etc.)
        this.clients = new Map();

        // The drawing state - stores all drawing operations
        // This is shared across all clients in the room
        this.drawingState = new DrawingState();

        // Counter for assigning unique colors to users
        this.userColorIndex = 0;

        // When this room was created
        this.createdAt = Date.now();

        // When was the last action in this room
        // Used to cleanup empty inactive rooms
        this.lastActivityAt = Date.now();
    }

    /**
     * Add a new client to this room
     * 
     * Called when a user joins. We assign them a color and track their connection.
     * 
     * @param {WebSocket} ws - The WebSocket connection object
     * @param {string} userId - Unique user identifier
     * @param {string} username - Display name (what other users see)
     * @returns {Object} - Info about the newly joined client
     */
    addClient(ws, userId, username) {
        // Pick a color for this user (cycles through palette)
        const assignedColor = USER_COLORS[this.userColorIndex % USER_COLORS.length];
        this.userColorIndex++;

        // Create info object about this client
        const clientInfo = {
            userId,           // Unique ID
            username,         // Display name
            color,            // Their color for identification
            joinedAt: Date.now(),
            lastActivityAt: Date.now(),
            isActive: true
        };

        // Store the client info mapped to their WebSocket connection
        this.clients.set(ws, clientInfo);
        this.lastActivityAt = Date.now();

        console.log(
            `✓ Room "${this.id}": User "${username}" joined (${this.clients.size} total)`
        );

        return clientInfo;
    }

    /**
     * Remove a client from this room
     * 
     * Called when a user disconnects. Clean up their connection.
     * 
     * @param {WebSocket} ws - The disconnected WebSocket
     * @returns {Object|null} - Info about removed client, or null if not found
     */
    removeClient(ws) {
        const clientInfo = this.clients.get(ws);

        if (clientInfo) {
            this.clients.delete(ws);
            console.log(
                `✗ Room "${this.id}": User "${clientInfo.username}" left (${this.clients.size} remaining)`
            );
            return clientInfo;
        }

        return null;
    }

    /**
     * Send a message to all clients EXCEPT one
     * 
     * Used to broadcast updates to other users, but not to the sender
     * (they usually already know about their own action)
     * 
     * @param {Object} data - Message to send
     * @param {WebSocket} excludeWs - Don't send to this connection
     */
    broadcast(data, excludeWs = null) {
        // Convert data to JSON string once (more efficient)
        const message = JSON.stringify(data);

        // Send to each connected client
        this.clients.forEach((clientInfo, ws) => {
            // Skip if WebSocket is closed or if this is the excluded client
            if (ws.readyState === 1 && ws !== excludeWs) { // 1 = OPEN
                try {
                    ws.send(message);
                } catch (error) {
                    // If send fails, log it but keep going with other clients
                    console.error(
                        `Room "${this.id}": Failed to send to client - ${error.message}`
                    );
                }
            }
        });
    }

    /**
     * Send a message to ALL clients INCLUDING the sender
     * 
     * Used for system messages like "user joined" that everyone needs to see.
     * 
     * @param {Object} data - Message to broadcast
     */
    broadcastAll(data) {
        this.broadcast(data, null); // null = don't exclude anyone
    }

    /**
     * Get list of all active users currently in this room
     * 
     * Used to show the "who's online" list to clients.
     * 
     * @returns {Array} - Array of user info objects
     */
    getActiveUsers() {
        const users = [];

        this.clients.forEach((clientInfo) => {
            // Only include active users (ignore temporarily disconnected)
            if (clientInfo.isActive) {
                users.push({
                    userId: clientInfo.userId,
                    username: clientInfo.username,
                    color: clientInfo.color,
                    joinedAt: clientInfo.joinedAt
                });
            }
        });

        return users;
    }

    /**
     * How many clients are connected to this room?
     * 
     * @returns {number} - Number of connected clients
     */
    getClientCount() {
        return this.clients.size;
    }

    /**
     * Is this room completely empty?
     * 
     * Used to decide whether to delete an unused room.
     * 
     * @returns {boolean} - True if no one is in the room
     */
    isEmpty() {
        return this.clients.size === 0;
    }

    /**
     * Record a drawing operation
     * 
     * When a user draws, we store it here so new users can replay it.
     * 
     * @param {Object} operation - The drawing action
     */
    recordOperation(operation) {
        this.drawingState.addOperation(operation);
        this.lastActivityAt = Date.now();
    }

    /**
     * Get all drawing operations in this room
     * 
     * Sent to new users so they see everything that was drawn before.
     * 
     * @returns {Array} - All drawing operations
     */
    getDrawingHistory() {
        return this.drawingState.getHistory();
    }

    /**
     * Get undo/redo operation history
     * 
     * @returns {Array} - All undo/redo operations
     */
    getOperationHistory() {
        return this.drawingState.getOperationHistory();
    }

    /**
     * Clear all drawings from this room
     * 
     * When user clicks "Clear Canvas", everything is erased.
     */
    clearDrawing() {
        this.drawingState.clear();
        this.lastActivityAt = Date.now();
    }

    /**
     * Get statistics about this room
     * 
     * Useful for monitoring and debugging.
     * 
     * @returns {Object} - Room stats
     */
    getStats() {
        return {
            id: this.id,
            clientCount: this.clients.size,
            operationCount: this.drawingState.getHistory().length,
            createdAt: this.createdAt,
            lastActivityAt: this.lastActivityAt,
            uptime: Date.now() - this.createdAt,
            users: this.getActiveUsers()
        };
    }

    /**
     * Destroy this room and cleanup
     * 
     * Called before deleting the room permanently.
     */
    destroy() {
        this.clients.clear();
        this.drawingState.clear();
        console.log(`Room "${this.id}" has been destroyed`);
    }
}

/**
 * RoomManager Class
 * 
 * The "manager" of all rooms.
 * 
 * Responsibilities:
 * - Create new rooms when users request them
 * - Keep track of all active rooms
 * - Delete empty rooms to save memory
 * - Provide access to specific rooms
 */
class RoomManager {
    constructor() {
        // Map of all active rooms
        // Key: room ID
        // Value: DrawingRoom object
        this.rooms = new Map();

        // Handle for the cleanup interval
        this.roomCleanupInterval = null;

        // Start background cleanup process
        this.startCleanupInterval();
    }

    /**
     * Get an existing room or create it if it doesn't exist
     * 
     * This is the main entry point. Call this to get a room.
     * 
     * @param {string} roomId - Room identifier
     * @returns {DrawingRoom} - The room object
     */
    getOrCreateRoom(roomId) {
        // If room doesn't exist, create it
        if (!this.rooms.has(roomId)) {
            const newRoom = new DrawingRoom(roomId);
            this.rooms.set(roomId, newRoom);
            console.log(`→ New room created: "${roomId}"`);
        }

        // Return the room (either existing or newly created)
        return this.rooms.get(roomId);
    }

    /**
     * Get an existing room (don't create if missing)
     * 
     * @param {string} roomId - Room to find
     * @returns {DrawingRoom|null} - The room or null if not found
     */
    getRoom(roomId) {
        return this.rooms.get(roomId) || null;
    }

    /**
     * Delete a room permanently
     * 
     * @param {string} roomId - Room to delete
     */
    deleteRoom(roomId) {
        const room = this.rooms.get(roomId);

        if (room) {
            room.destroy();
            this.rooms.delete(roomId);
            console.log(`→ Room deleted: "${roomId}"`);
        }
    }

    /**
     * Get all currently active rooms
     * 
     * @returns {Array} - All room objects
     */
    getAllRooms() {
        return Array.from(this.rooms.values());
    }

    /**
     * Get statistics for all rooms
     * 
     * Useful for server monitoring dashboard.
     * 
     * @returns {Array} - Stats for each room
     */
    getRoomsStats() {
        return Array.from(this.rooms.values()).map(room => room.getStats());
    }

    /**
     * Start automatic cleanup process
     * 
     * Runs in the background and removes empty, inactive rooms.
     * This prevents the server from keeping dead rooms in memory forever.
     * 
     * Cleanup rule: Delete room if empty AND inactive for 1+ hour
     */
    startCleanupInterval() {
        this.roomCleanupInterval = setInterval(() => {
            const now = Date.now();
            const oneHourInMs = 60 * 60 * 1000;
            const inactivityThreshold = now - oneHourInMs;

            let deletedCount = 0;

            // Check each room
            this.rooms.forEach((room, roomId) => {
                // If room is empty AND hasn't been used in 1 hour
                if (room.isEmpty() && room.lastActivityAt < inactivityThreshold) {
                    this.deleteRoom(roomId);
                    deletedCount++;
                }
            });

            // Log status periodically
            if (this.rooms.size > 0) {
                console.log(`→ Active rooms: ${this.rooms.size}` +
                    (deletedCount > 0 ? ` (cleaned up ${deletedCount})` : ''));
            }
        }, 60000); // Check every 60 seconds
    }

    /**
     * Stop the cleanup process
     * 
     * Called when server is shutting down.
     */
    stopCleanupInterval() {
        if (this.roomCleanupInterval) {
            clearInterval(this.roomCleanupInterval);
            this.roomCleanupInterval = null;
        }
    }

    /**
     * Shutdown the manager
     * 
     * Called when server is stopping.
     * Cleans up all rooms and stops background processes.
     */
    destroy() {
        this.stopCleanupInterval();
        this.rooms.forEach((room) => room.destroy());
        this.rooms.clear();
        console.log('→ RoomManager shut down');
    }
}

module.exports = { RoomManager, DrawingRoom };