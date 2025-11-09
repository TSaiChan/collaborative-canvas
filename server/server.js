/**
 * COLLABORATIVE DRAWING CANVAS - SERVER
 * 
 * Main server file that:
 * - Serves the HTML/CSS/JS to browsers
 * - Manages WebSocket connections
 * - Routes drawing events between users
 * - Maintains drawing state in memory
 */

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { RoomManager } = require('./rooms');

// ===== INITIALIZE SERVER =====

// Create Express app for serving static files
const app = express();

// Create HTTP server (needed for WebSocket)
const server = http.createServer(app);

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server });

// Serve static files (HTML, CSS, JS) from the client folder
app.use(express.static(path.join(__dirname, '../client')));

// ===== CORE STATE =====

// Manager for all drawing rooms
const roomManager = new RoomManager();

// ===== WEBSOCKET CONNECTION HANDLER =====

/**
 * When a browser connects via WebSocket, this fires
 * 
 * Each connection represents one user/tab
 */
wss.on('connection', (ws) => {
    // Unique identifier for this connection
    let userId = uuidv4();

    // Display name (username)
    let username = `User-${Math.floor(Math.random() * 10000)}`;

    // Reference to the user's current room
    let currentRoom = null;

    // User's info (color, etc.)
    let userInfo = null;

    console.log(`🔌 Client connected: ${userId}`);

    /**
     * Handle incoming messages from the client
     * 
     * Each message has a "type" that tells us what to do
     */
    ws.on('message', (message) => {
        try {
            // Parse the JSON message
            const data = JSON.parse(message);

            // Route to appropriate handler based on message type
            switch (data.type) {
                case 'JOIN_ROOM':
                    handleJoinRoom(data);
                    break;

                case 'DRAW':
                    handleDraw(data);
                    break;

                case 'ERASE':
                    handleErase(data);
                    break;

                case 'UNDO':
                    handleUndo(data);
                    break;

                case 'REDO':
                    handleRedo(data);
                    break;

                case 'CLEAR_CANVAS':
                    handleClearCanvas(data);
                    break;

                case 'CURSOR_MOVE':
                    handleCursorMove(data);
                    break;

                default:
                    console.warn(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error('Error processing message:', error.message);
            // Send error back to client
            try {
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: 'Server failed to process your message'
                }));
            } catch (e) {
                // Client disconnected, ignore
            }
        }
    });

    /**
     * Handle client disconnect
     */
    ws.on('close', () => {
        console.log(`🔌 Client disconnected: ${userId}`);

        // If user was in a room, remove them
        if (currentRoom) {
            currentRoom.removeClient(ws);

            // Notify other users in the room
            if (!currentRoom.isEmpty()) {
                currentRoom.broadcastAll({
                    type: 'USER_LEFT',
                    users: currentRoom.getActiveUsers(),
                    clientCount: currentRoom.getClientCount()
                });
            } else {
                // Room is now empty, delete it
                roomManager.deleteRoom(currentRoom.id);
            }
        }
    });

    /**
     * Handle WebSocket errors
     */
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${userId}:`, error.message);
    });

    // ===== MESSAGE HANDLERS =====

    /**
     * User wants to join a room
     * 
     * Flow:
     * 1. Get or create the room
     * 2. Add user to room
     * 3. Send drawing history (so they see previous drawings)
     * 4. Tell other users someone joined
     */
    function handleJoinRoom(data) {
        // Get room ID from message, default to "default" if not specified
        const roomId = data.roomId || 'default';

        // Use provided username or generate one
        username = data.username || username;

        // Get the room (creates it if doesn't exist)
        currentRoom = roomManager.getOrCreateRoom(roomId);

        // Add this client to the room
        userInfo = currentRoom.addClient(ws, userId, username);

        console.log(`✓ "${username}" joined room "${roomId}"`);

        // ===== STEP 1: Send new user all existing drawings =====
        ws.send(JSON.stringify({
            type: 'LOAD_HISTORY',
            drawingHistory: currentRoom.getDrawingHistory(),
            operationHistory: currentRoom.getOperationHistory(),
            userInfo: userInfo,  // Their color, ID, etc.
            roomStats: currentRoom.getStats()
        }));

        // ===== STEP 2: Tell everyone this user joined =====
        currentRoom.broadcastAll({
            type: 'USER_JOINED',
            users: currentRoom.getActiveUsers(),
            clientCount: currentRoom.getClientCount()
        });
    }

    /**
     * User drew a stroke
     * 
     * Flow:
     * 1. Create operation object
     * 2. Store in room's history
     * 3. Broadcast to all other users
     */
    function handleDraw(data) {
        // Safety check - user must be in a room
        if (!currentRoom || !userId) {
            console.warn('DRAW: User not in room');
            return;
        }

        // Create operation object with all details
        const operation = {
            type: 'DRAW',
            userId: userId,
            x0: data.x0,            // Starting point X
            y0: data.y0,            // Starting point Y
            x1: data.x1,            // Ending point X
            x1: data.y1,            // Ending point Y
            color: data.color,      // Stroke color
            size: data.size,        // Stroke width
            timestamp: data.timestamp,
            operationId: data.operationId
        };

        // Store in room's drawing history
        currentRoom.recordOperation(operation);

        // Broadcast to all OTHER users (sender already drew it locally)
        currentRoom.broadcast(
            {
                type: 'DRAW',
                userId: userId,
                x0: data.x0,
                y0: data.y0,
                x1: data.x1,
                y1: data.y1,
                color: data.color,
                size: data.size,
                timestamp: data.timestamp,
                operationId: data.operationId
            },
            ws  // Don't send to this WebSocket (the sender)
        );
    }

    /**
     * User erased part of canvas
     * 
     * Same flow as DRAW, but for erase operations
     */
    function handleErase(data) {
        if (!currentRoom || !userId) {
            console.warn('ERASE: User not in room');
            return;
        }

        const operation = {
            type: 'ERASE',
            userId: userId,
            x0: data.x0,
            y0: data.y0,
            x1: data.x1,
            y1: data.y1,
            size: data.size,
            timestamp: data.timestamp,
            operationId: data.operationId
        };

        currentRoom.recordOperation(operation);

        currentRoom.broadcast(
            {
                type: 'ERASE',
                userId: userId,
                x0: data.x0,
                y0: data.y0,
                x1: data.x1,
                y1: data.y1,
                size: data.size,
                timestamp: data.timestamp,
                operationId: data.operationId
            },
            ws
        );
    }

    /**
     * User pressed Undo
     * 
     * Remove the specified operation from history.
     * All users will rebuild canvas without that operation.
     */
    function handleUndo(data) {
        if (!currentRoom) {
            console.warn('UNDO: User not in room');
            return;
        }

        // Tell drawing state to undo
        const success = currentRoom.drawingState.recordUndo(data);

        if (success) {
            // Broadcast undo to ALL users
            currentRoom.broadcastAll({
                type: 'UNDO',
                userId: userId,
                operationId: data.operationId,
                timestamp: data.timestamp
            });

            console.log(`↶ User ${userId} undid operation`);
        } else {
            console.warn(`Undo failed for operation ${data.operationId}`);
        }
    }

    /**
     * User pressed Redo
     * 
     * Restore a previously undone operation.
     */
    function handleRedo(data) {
        if (!currentRoom) {
            console.warn('REDO: User not in room');
            return;
        }

        const success = currentRoom.drawingState.recordRedo(data);

        if (success) {
            currentRoom.broadcastAll({
                type: 'REDO',
                userId: userId,
                operationId: data.operationId,
                timestamp: data.timestamp
            });

            console.log(`↷ User ${userId} redid operation`);
        } else {
            console.warn('Redo failed');
        }
    }

    /**
     * User clicked "Clear Canvas"
     * 
     * Wipe all drawings from this room.
     */
    function handleClearCanvas(data) {
        if (!currentRoom) {
            console.warn('CLEAR_CANVAS: User not in room');
            return;
        }

        // Wipe the drawing state
        currentRoom.clearDrawing();

        // Tell everyone to clear their canvas
        currentRoom.broadcastAll({
            type: 'CLEAR_CANVAS',
            userId: userId,
            timestamp: data.timestamp
        });

        console.log(`🗑️  Canvas cleared in room "${currentRoom.id}"`);
    }

    /**
     * User moved their mouse
     * 
     * Broadcast cursor position to show where others are drawing.
     * Note: Doesn't send to sender (they don't need to see their own cursor update)
     */
    function handleCursorMove(data) {
        if (!currentRoom) {
            return; // Silently ignore if not in room
        }

        // Send to all OTHER users
        currentRoom.broadcast(
            {
                type: 'CURSOR_MOVE',
                userId: userId,
                x: data.x,
                y: data.y
            },
            ws
        );
    }
});

// ===== OPTIONAL ENDPOINTS =====

/**
 * Health check endpoint
 * 
 * Can be used to monitor server status
 * Access: GET http://localhost:3000/health
 */
app.get('/health', (req, res) => {
    const stats = {
        status: 'ok',
        timestamp: Date.now(),
        rooms: roomManager.getRoomsStats(),
        connections: wss.clients.size
    };
    res.json(stats);
});

// ===== START SERVER =====

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🎨 Collaborative Drawing Canvas Server Started 🎨    ║
║                                                            ║
║     Server: http://localhost:${PORT}                        ║
║     WebSocket: ws://localhost:${PORT}                       ║
║                                                            ║
║     Open browser tabs and start drawing together!        ║
║     Room Management: Auto-cleanup enabled                 ║
║     Health Check: http://localhost:${PORT}/health          ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// ===== GRACEFUL SHUTDOWN =====

/**
 * Handle server shutdown gracefully
 * 
 * When you press Ctrl+C, this cleans up properly instead of crashing
 */
process.on('SIGINT', () => {
    console.log('\n⏹️  Shutting down server gracefully...');

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        client.close();
    });

    // Clean up room manager
    roomManager.destroy();

    // Close HTTP server
    server.close(() => {
        console.log('✓ Shutdown complete');
        process.exit(0);
    });

    // Force exit after 10 seconds if something is stuck
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
});

module.exports = { app, server, wss, roomManager };