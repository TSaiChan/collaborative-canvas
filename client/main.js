/**
 * DrawingApp Class
 * 
 * Main application controller that ties everything together.
 * 
 * Manages:
 * - Initialization
 * - UI event listeners
 * - WebSocket communication
 * - Canvas drawing
 * - User interface updates
 */
class DrawingApp {
    constructor() {
        // Canvas drawing manager
        this.canvas = null;

        // WebSocket connection manager
        this.ws = null;

        // Current user's ID
        this.userId = null;

        // Current user's display name
        this.username = null;

        // Current user's info (color, etc.)
        this.userInfo = {};

        // Map of other users (for cursor tracking)
        this.remoteUsers = new Map();

        // Map of remote user cursors
        this.cursorTracker = new Map();

        // Is this a local action or remote?
        // (Prevents double-processing)
        this.isLocal = true;

        // Start the app
        this.init();
    }

    /**
     * Initialize the application
     * 
     * Shows the join modal and waits for user to enter details.
     */
    async init() {
        // Show the "join room" modal
        this.showRoomModal();
    }

    /**
     * Show the join room modal
     * 
     * Waits for user to enter username and choose room.
     */
    showRoomModal() {
        const modal = document.getElementById('roomModal');
        const form = document.getElementById('roomForm');

        form.addEventListener('submit', (e) => {
            e.preventDefault();

            // Get values from form
            const roomInput = document.getElementById('roomInput').value || 'default';
            const usernameInput = document.getElementById('usernameInput').value;

            // Validate username is not empty
            if (usernameInput.trim()) {
                // Hide modal
                modal.classList.add('hidden');

                // Start the app with chosen settings
                this.startApp(roomInput, usernameInput);
            }
        });
    }

    /**
     * Start the actual drawing app
     * 
     * @param {string} roomId - Room to join
     * @param {string} username - User's display name
     */
    async startApp(roomId, username) {
        this.username = username;

        // ===== STEP 1: Initialize Canvas =====

        console.log('Initializing canvas...');
        this.canvas = new CanvasManager('drawingCanvas');

        // ===== STEP 2: Initialize WebSocket =====

        console.log('Connecting to server...');
        this.ws = new WebSocketManager();

        // Try to connect to server
        try {
            await this.ws.connect();
        } catch (error) {
            console.error('Failed to connect:', error);
            alert('Failed to connect to server. Please refresh the page.');
            return;
        }

        // ===== STEP 3: Setup WebSocket Listeners =====

        this.setupWebSocketListeners();

        // ===== STEP 4: Join Room =====

        console.log(`Joining room: "${roomId}" as "${username}"`);
        this.ws.joinRoom(roomId, username);

        // ===== STEP 5: Setup UI =====

        this.setupUIListeners();

        // ===== STEP 6: Setup Keyboard =====

        this.setupKeyboardShortcuts();

        // ===== STEP 7: Update Display =====

        this.updateUIElements();
    }

    /**
     * Setup WebSocket event listeners
     * 
     * Listen for messages from other clients.
     */
    setupWebSocketListeners() {
        // ===== RECEIVING DRAWING HISTORY =====

        /**
         * When new user joins, server sends all previous drawings
         * so they see what was drawn before
         */
        this.ws.on('LOAD_HISTORY', (data) => {
            console.log('Replaying drawing history...');

            // Replay all previous operations on canvas
            this.canvas.loadDrawingHistory(data.drawingHistory || []);

            // Store our info
            this.userInfo = data.userInfo;
            this.userId = data.userInfo.userId;

            // Show our ID in UI
            const myUserIdEl = document.getElementById('myUserId');
            if (myUserIdEl) myUserIdEl.textContent = this.userId;

            console.log('✓ History loaded');
        });

        // ===== USER MANAGEMENT =====

        /**
         * Another user joined the room
         */
        this.ws.on('USER_JOINED', (data) => {
            console.log(`User joined: ${data.clientCount} total`);

            // Update user list in UI
            this.updateUsersList(data.users);

            // Update user count
            const userCountEl = document.getElementById('userCount');
            if (userCountEl) userCountEl.textContent = data.clientCount;

            const roomIdEl = document.getElementById('roomId');
            if (roomIdEl) roomIdEl.textContent = this.ws.currentRoom;
        });

        /**
         * A user left the room
         */
        this.ws.on('USER_LEFT', (data) => {
            console.log(`User left: ${data.clientCount} remaining`);

            // Update user list
            this.updateUsersList(data.users);

            // Update count
            const userCountEl = document.getElementById('userCount');
            if (userCountEl) userCountEl.textContent = data.clientCount;
        });

        // ===== REMOTE DRAWING =====

        /**
         * Another user drew something
         */
        this.ws.on('DRAW', (data) => {
            // Don't draw our own strokes (we already did locally)
            if (data.userId !== this.userId) {
                this.canvas.remoteDrawBrush(
                    data.x0,
                    data.y0,
                    data.x1,
                    data.y1,
                    data.color,
                    data.size
                );
            }
        });

        /**
         * Another user erased something
         */
        this.ws.on('ERASE', (data) => {
            if (data.userId !== this.userId) {
                this.canvas.remoteErase(
                    data.x0,
                    data.y0,
                    data.x1,
                    data.y1,
                    data.size
                );
            }
        });

        // ===== CANVAS OPERATIONS =====

        /**
         * Someone cleared the canvas
         */
        this.ws.on('CLEAR_CANVAS', (data) => {
            // If it wasn't us, clear our canvas too
            if (data.userId !== this.userId) {
                this.canvas.ctx.clearRect(0, 0, this.canvas.canvas.width, this.canvas.canvas.height);
                this.canvas.drawingStates = [];
                this.canvas.currentStateIndex = -1;
                this.canvas.saveState();
            }
        });

        // ===== UNDO/REDO =====

        /**
         * Someone pressed undo
         */
        this.ws.on('UNDO', (data) => {
            if (data.userId !== this.userId) {
                this.canvas.remoteUndo();
            }
        });

        /**
         * Someone pressed redo
         */
        this.ws.on('REDO', (data) => {
            if (data.userId !== this.userId) {
                this.canvas.remoteRedo();
            }
        });

        // ===== REMOTE CURSORS =====

        /**
         * Another user moved their mouse/cursor
         * (for showing where they're drawing)
         */
        this.ws.on('CURSOR_MOVE', (data) => {
            this.updateRemoteCursor(data.userId, data.x, data.y);
        });

        // ===== CONNECTION STATUS =====

        /**
         * Listen for connection status changes
         */
        window.addEventListener('ws-event', (e) => {
            const { type, data } = e.detail;

            // Get status badge element
            const statusBadge = document.getElementById('connectionStatus');

            if (type === 'CONNECTED') {
                statusBadge.textContent = 'Connected';
                statusBadge.className = 'status-badge status-connected';
            } else if (type === 'DISCONNECTED') {
                statusBadge.textContent = 'Disconnected';
                statusBadge.className = 'status-badge status-disconnected';
            } else if (type === 'RECONNECTING') {
                statusBadge.textContent = `Reconnecting... (${data})`;
                statusBadge.className = 'status-badge status-connecting';
            } else if (type === 'CONNECTION_FAILED') {
                statusBadge.textContent = 'Connection Failed';
                statusBadge.className = 'status-badge status-disconnected';
            }
        });
    }

    /**
     * Setup UI event listeners
     * 
     * Listen for button clicks, slider changes, etc.
     */
    setupUIListeners() {
        // ===== TOOL SELECTION =====

        /**
         * User clicked on a tool button (brush/eraser)
         */
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Remove active class from all buttons
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));

                // Add active class to clicked button
                btn.classList.add('active');

                // Tell canvas which tool to use
                this.canvas.setTool(btn.dataset.tool);
            });
        });

        // ===== COLOR SELECTION =====

        /**
         * User opened color picker
         */
        const colorPicker = document.getElementById('colorPicker');
        const colorPreview = document.getElementById('colorPreview');

        if (colorPicker && colorPreview) {
            colorPicker.addEventListener('change', (e) => {
                const color = e.target.value;
                this.canvas.setColor(color);
                colorPreview.style.background = color;
            });

            /**
             * User clicked a preset color
             */
            document.querySelectorAll('.color-preset').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const color = btn.dataset.color;

                    // Update color picker
                    colorPicker.value = color;

                    // Update canvas
                    this.canvas.setColor(color);

                    // Update preview
                    colorPreview.style.background = color;
                });
            });
        }

        // ===== BRUSH SIZE =====

        /**
         * User moved brush size slider
         */
        const brushSizeInput = document.getElementById('brushSize');
        if (brushSizeInput) {
            brushSizeInput.addEventListener('input', (e) => {
                this.canvas.setBrushSize(e.target.value);
                const sizeDisplay = document.getElementById('sizeDisplay');
                if (sizeDisplay) sizeDisplay.textContent = `${e.target.value}px`;
            });
        }

        // ===== ERASER SIZE =====

        /**
         * User moved eraser size slider
         */
        const eraserSizeInput = document.getElementById('eraserSize');
        if (eraserSizeInput) {
            eraserSizeInput.addEventListener('input', (e) => {
                this.canvas.setEraserSize(e.target.value);
                const eraserDisplay = document.getElementById('eraserDisplay');
                if (eraserDisplay) eraserDisplay.textContent = `${e.target.value}px`;
            });
        }

        // ===== UNDO/REDO BUTTONS =====

        /**
         * User clicked Undo button
         */
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                const stateIndex = this.canvas.undo();
                if (stateIndex >= 0) {
                    this.ws.sendUndo(this.userId, stateIndex);
                }
            });
        }

        /**
         * User clicked Redo button
         */
        const redoBtn = document.getElementById('redoBtn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                const stateIndex = this.canvas.redo();
                if (stateIndex >= 0) {
                    this.ws.sendRedo(this.userId, stateIndex);
                }
            });
        }

        // ===== CLEAR CANVAS =====

        /**
         * User clicked Clear Canvas button
         */
        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                // Ask for confirmation (it can't be undone server-side)
                if (confirm('Clear canvas? Everyone will see the change.')) {
                    this.canvas.clearCanvas();
                    this.ws.sendClearCanvas(this.userId);
                }
            });
        }

        // ===== MOUSE TRACKING =====

        /**
         * Track cursor position for remote users
         * (Throttled to reduce network traffic)
         */
        let lastDrawTime = 0;
        const throttleDelay = 20; // ~50 FPS

        this.canvas.canvas.addEventListener('mousemove', (e) => {
            const currentTime = Date.now();

            // Only send cursor update every 20ms
            if (currentTime - lastDrawTime > throttleDelay) {
                const rect = this.canvas.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                this.ws.sendCursorPosition(x, y);
                lastDrawTime = currentTime;
            }
        });

        // ===== INTERCEPT CANVAS DRAWING =====

        this.interceptCanvasDrawing();
    }

    /**
     * Intercept canvas drawing operations and send to server
     * 
     * This is the key to real-time sync!
     * When canvas draws locally, we capture it and send to server.
     */
    interceptCanvasDrawing() {
        // Save original methods
        const originalDrawBrush = this.canvas.drawBrush.bind(this.canvas);
        const originalEraseStroke = this.canvas.eraseStroke.bind(this.canvas);

        // Replace with wrapper that sends to server
        this.canvas.drawBrush = (x0, y0, x1, y1) => {
            // Call original method (draw locally)
            originalDrawBrush(x0, y0, x1, y1);

            // If user is drawing (not a redo/replay), send to server
            if (this.canvas.isDrawing && this.userId) {
                this.ws.sendDraw(
                    x0, y0, x1, y1,
                    this.canvas.currentColor,
                    this.canvas.brushSize,
                    this.userId
                );
            }
        };

        this.canvas.eraseStroke = (x0, y0, x1, y1) => {
            // Call original method (erase locally)
            originalEraseStroke(x0, y0, x1, y1);

            // If user is erasing, send to server
            if (this.canvas.isDrawing && this.userId) {
                this.ws.sendErase(
                    x0, y0, x1, y1,
                    this.canvas.eraserSize,
                    this.userId
                );
            }
        };
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // ===== UNDO: Ctrl+Z or Cmd+Z =====
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();

                const stateIndex = this.canvas.undo();
                if (stateIndex >= 0) {
                    this.ws.sendUndo(this.userId, stateIndex);
                }
            }

            // ===== REDO: Ctrl+Shift+Z or Cmd+Shift+Z =====
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y') && e.shiftKey) {
                e.preventDefault();

                const stateIndex = this.canvas.redo();
                if (stateIndex >= 0) {
                    this.ws.sendRedo(this.userId, stateIndex);
                }
            }

            // ===== BRUSH: Press B =====
            if (e.key === 'b' || e.key === 'B') {
                const brushBtn = document.querySelector('[data-tool="brush"]');
                if (brushBtn) brushBtn.click();
            }

            // ===== ERASER: Press E =====
            if (e.key === 'e' || e.key === 'E') {
                const eraserBtn = document.querySelector('[data-tool="eraser"]');
                if (eraserBtn) eraserBtn.click();
            }
        });
    }

    /**
     * Update the active users list in the UI
     * 
     * @param {Array} users - Array of user objects
     */
    updateUsersList(users) {
        const usersList = document.getElementById('usersList');

        if (!usersList) return;

        // Clear current list
        usersList.innerHTML = '';

        // If no users, show message
        if (users.length === 0) {
            usersList.innerHTML = '<p class="empty-state">No users connected</p>';
            return;
        }

        // Add each user to the list
        users.forEach(user => {
            // Create user item container
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            userItem.style.borderLeftColor = user.color;

            // Create color dot
            const colorDot = document.createElement('div');
            colorDot.className = 'user-color-dot';
            colorDot.style.backgroundColor = user.color;

            // Create user info
            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';

            // Create username display
            const userName = document.createElement('span');
            userName.className = 'user-name';
            userName.textContent = user.username;

            // Create status
            const userStatus = document.createElement('span');
            userStatus.className = 'user-status';

            // Show "(You)" if it's current user
            userStatus.textContent = user.userId === this.userId ? '(You)' : 'Active';

            // Assemble the UI
            userInfo.appendChild(userName);
            userInfo.appendChild(userStatus);
            userItem.appendChild(colorDot);
            userItem.appendChild(userInfo);
            usersList.appendChild(userItem);
        });
    }

    /**
     * Update remote user cursor position
     * 
     * Shows a visual indicator of where remote users are drawing.
     * 
     * @param {string} userId - User ID
     * @param {number} x - Cursor X
     * @param {number} y - Cursor Y
     */
    updateRemoteCursor(userId, x, y) {
        // Don't show our own cursor
        if (userId === this.userId) return;

        // Get container for cursor indicators
        const indicators = document.getElementById('cursorIndicators');

        if (!indicators) return;

        // Look for existing cursor for this user
        let cursor = document.getElementById(`cursor-${userId}`);

        // If doesn't exist, create it
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.id = `cursor-${userId}`;
            cursor.className = 'remote-cursor';
            indicators.appendChild(cursor);

            // Assign random color
            const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
            cursor.style.borderColor = randomColor;
            cursor.style.backgroundColor = randomColor;
        }

        // Position the cursor
        cursor.style.left = `${x - 10}px`;
        cursor.style.top = `${y - 10}px`;

        // Clear previous hide timer
        if (cursor.hideTimeout) {
            clearTimeout(cursor.hideTimeout);
        }

        // Make cursor visible
        cursor.style.opacity = '1';

        // Hide cursor after 1 second of inactivity
        cursor.hideTimeout = setTimeout(() => {
            cursor.style.opacity = '0.3';
        }, 1000);
    }

    /**
     * Update UI elements on startup
     */
    updateUIElements() {
        // Initialize color preview
        const colorPicker = document.getElementById('colorPicker');
        const colorPreview = document.getElementById('colorPreview');
        if (colorPicker && colorPreview) {
            colorPreview.style.background = colorPicker.value;
        }
    }
}

/**
 * START APPLICATION
 * 
 * When page loads, create and start the app
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded, starting app...');
    window.app = new DrawingApp();
});