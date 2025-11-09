/**
 * CanvasManager Class
 * 
 * Handles all drawing operations on the HTML5 Canvas element.
 * 
 * This class is responsible for:
 * - Drawing brush strokes
 * - Erasing parts of canvas
 * - Managing undo/redo history
 * - Replaying remote users' drawings
 * - Handling mouse and touch events
 */
class CanvasManager {
    constructor(canvasId) {
        // Get reference to the canvas HTML element
        this.canvas = document.getElementById(canvasId);

        // Get 2D drawing context (the thing we actually draw with)
        this.ctx = this.canvas.getContext('2d');

        // Is the user currently drawing?
        this.isDrawing = false;

        // Last mouse/touch position (for drawing lines)
        this.lastX = 0;
        this.lastY = 0;

        // Current tool: 'brush' or 'eraser'
        this.currentTool = 'brush';

        // Current color (hex string like #000000)
        this.currentColor = '#000000';

        // Brush stroke width in pixels
        this.brushSize = 3;

        // Eraser size in pixels
        this.eraserSize = 20;

        // ===== UNDO/REDO SYSTEM =====

        // Array of canvas states (images) for undo/redo
        // Each element is a snapshot of the canvas at a point in time
        this.drawingStates = [];

        // Which state are we currently at? (index)
        this.currentStateIndex = -1;

        // Don't keep more than this many states (prevent memory issues)
        this.maxHistoryStates = 50;

        // Stack of operations for tracking
        this.operationStack = [];

        // Stack for operations that were undone
        this.undoStack = [];

        // Counter for operation IDs
        this.operationIdCounter = 0;

        // Initialize the canvas
        this.setupCanvas();
        this.bindEvents();

        // Save initial blank state
        this.saveState();
    }

    /**
     * Set up the canvas (sizing and events)
     */
    setupCanvas() {
        // Set canvas to fill its container
        this.resizeCanvas();

        // Resize canvas if window size changes
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    /**
     * Resize canvas to fit its container
     */
    resizeCanvas() {
        const wrapper = this.canvas.parentElement;

        // Set canvas dimensions to match container
        this.canvas.width = wrapper.clientWidth;
        this.canvas.height = wrapper.clientHeight;

        // Redraw if we have previous state
        this.redrawCanvas();
    }

    /**
     * Attach mouse and touch event listeners
     */
    bindEvents() {
        // ===== MOUSE EVENTS =====

        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));

        // ===== TOUCH EVENTS (for mobile) =====

        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }

    /**
     * Handle mouse button pressed down
     */
    handleMouseDown(e) {
        // User is now drawing
        this.isDrawing = true;

        // Get canvas position
        const rect = this.canvas.getBoundingClientRect();

        // Convert screen coordinates to canvas coordinates
        this.lastX = e.clientX - rect.left;
        this.lastY = e.clientY - rect.top;

        // Mark the start of a new operation
        this.currentOperationId = this.operationIdCounter++;
    }

    /**
     * Handle mouse moved
     */
    handleMouseMove(e) {
        // If not drawing, ignore
        if (!this.isDrawing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Draw a line from last position to current position
        this.drawStroke(this.lastX, this.lastY, x, y);

        // Update last position for next move event
        this.lastX = x;
        this.lastY = y;
    }

    /**
     * Handle mouse button released
     */
    handleMouseUp(e) {
        if (this.isDrawing) {
            this.isDrawing = false;

            // Save this as a state we can undo back to
            this.saveState();
        }
    }

    /**
     * Handle mouse left the canvas
     */
    handleMouseLeave(e) {
        if (this.isDrawing) {
            this.isDrawing = false;
        }
    }

    // ===== TOUCH SUPPORT (MOBILE/TABLET) =====

    /**
     * Handle touch started
     */
    handleTouchStart(e) {
        e.preventDefault(); // Don't let browser do default touch handling

        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();

        this.isDrawing = true;
        this.lastX = touch.clientX - rect.left;
        this.lastY = touch.clientY - rect.top;
        this.currentOperationId = this.operationIdCounter++;
    }

    /**
     * Handle touch moved
     */
    handleTouchMove(e) {
        e.preventDefault();

        if (!this.isDrawing) return;

        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        this.drawStroke(this.lastX, this.lastY, x, y);
        this.lastX = x;
        this.lastY = y;
    }

    /**
     * Handle touch ended
     */
    handleTouchEnd(e) {
        e.preventDefault();

        if (this.isDrawing) {
            this.isDrawing = false;
            this.saveState();
        }
    }

    // ===== DRAWING OPERATIONS =====

    /**
     * Draw a stroke (line) between two points
     * 
     * Chooses between brush or eraser based on current tool.
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     */
    drawStroke(x0, y0, x1, y1) {
        if (this.currentTool === 'brush') {
            this.drawBrush(x0, y0, x1, y1);
        } else if (this.currentTool === 'eraser') {
            this.eraseStroke(x0, y0, x1, y1);
        }
    }

    /**
     * Draw a brush stroke
     * 
     * Uses the current color and brush size to draw a smooth line.
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     */
    drawBrush(x0, y0, x1, y1) {
        // Start a new path
        this.ctx.beginPath();

        // Move to starting point (don't draw yet)
        this.ctx.moveTo(x0, y0);

        // Draw line to ending point
        this.ctx.lineTo(x1, y1);

        // Make lines smooth at ends
        this.ctx.lineCap = 'round';

        // Make line joins smooth (where lines meet)
        this.ctx.lineJoin = 'round';

        // Set line thickness
        this.ctx.lineWidth = this.brushSize;

        // Set line color
        this.ctx.strokeStyle = this.currentColor;

        // Actually draw the line
        this.ctx.stroke();
    }

    /**
     * Erase part of the canvas
     * 
     * Works by clearing pixels in a rectangular area as we move.
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     */
    eraseStroke(x0, y0, x1, y1) {
        // Calculate distance we're erasing
        const dx = x1 - x0;
        const dy = y1 - y0;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Number of erase positions to try
        const steps = Math.ceil(distance);

        // Erase along the entire path
        for (let i = 0; i <= steps; i++) {
            // Calculate position between start and end
            const t = steps === 0 ? 0 : i / steps;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;

            // Clear a square area (eraser)
            this.ctx.clearRect(
                x - this.eraserSize / 2,
                y - this.eraserSize / 2,
                this.eraserSize,
                this.eraserSize
            );
        }
    }

    // ===== REMOTE DRAWING (FROM OTHER USERS) =====

    /**
     * Draw a brush stroke from another user
     * 
     * Called when we receive a DRAW message from the server.
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     * @param {string} color - Hex color
     * @param {number} size - Brush size
     */
    remoteDrawBrush(x0, y0, x1, y1, color, size) {
        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = size;
        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    /**
     * Apply eraser stroke from another user
     * 
     * @param {number} x0 - Starting X
     * @param {number} y0 - Starting Y
     * @param {number} x1 - Ending X
     * @param {number} y1 - Ending Y
     * @param {number} size - Eraser size
     */
    remoteErase(x0, y0, x1, y1, size) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.ceil(distance);

        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;

            this.ctx.clearRect(
                x - size / 2,
                y - size / 2,
                size,
                size
            );
        }
    }

    // ===== UNDO/REDO SYSTEM =====

    /**
     * Save current canvas state
     * 
     * Called after each drawing operation.
     * Allows us to undo back to this point.
     */
    saveState() {
        // If we're not at the end of history, remove everything after current point
        // (This is what happens when you undo and then do something new)
        if (this.currentStateIndex < this.drawingStates.length - 1) {
            this.drawingStates = this.drawingStates.slice(0, this.currentStateIndex + 1);
        }

        // If we have too many states, remove oldest ones
        if (this.drawingStates.length >= this.maxHistoryStates) {
            this.drawingStates.shift();
        } else {
            // We're adding a new state, so move index forward
            this.currentStateIndex++;
        }

        // Take a snapshot of current canvas and save it
        // (This is a data URL - a string representation of the image)
        this.drawingStates.push(this.canvas.toDataURL());

        // Update UI buttons (enable/disable undo/redo)
        this.updateUndoRedoButtons();
    }

    /**
     * Undo - go back one step
     * 
     * @returns {number} - New state index, or -1 if can't undo
     */
    undo() {
        // Can we go back further?
        if (this.currentStateIndex > 0) {
            // Go back one step
            this.currentStateIndex--;

            // Restore that state
            this.restoreState(this.currentStateIndex);

            // Update UI
            this.updateUndoRedoButtons();

            return this.currentStateIndex;
        }

        // Can't undo
        return -1;
    }

    /**
     * Redo - go forward one step
     * 
     * @returns {number} - New state index, or -1 if can't redo
     */
    redo() {
        // Is there a state ahead of us?
        if (this.currentStateIndex < this.drawingStates.length - 1) {
            // Move forward
            this.currentStateIndex++;

            // Restore that state
            this.restoreState(this.currentStateIndex);

            // Update UI
            this.updateUndoRedoButtons();

            return this.currentStateIndex;
        }

        // Can't redo
        return -1;
    }

    /**
     * Restore canvas to a specific state
     * 
     * @param {number} index - Which state to restore
     */
    restoreState(index) {
        // Check if index is valid
        if (index >= 0 && index < this.drawingStates.length) {
            // Get the saved image
            const img = new Image();

            // When image loads, draw it on canvas
            img.onload = () => {
                // Clear canvas first
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                // Draw the saved image
                this.ctx.drawImage(img, 0, 0);
            };

            // Load the image from the data URL
            img.src = this.drawingStates[index];
        }
    }

    /**
     * Update undo/redo button states in UI
     * 
     * Enable buttons if they can be used, disable if not.
     */
    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (undoBtn) {
            // Can undo if we're not at the beginning
            undoBtn.disabled = this.currentStateIndex <= 0;
        }

        if (redoBtn) {
            // Can redo if we're not at the end
            redoBtn.disabled = this.currentStateIndex >= this.drawingStates.length - 1;
        }
    }

    /**
     * Redraw canvas after resize
     */
    redrawCanvas() {
        if (this.currentStateIndex >= 0 && this.currentStateIndex < this.drawingStates.length) {
            this.restoreState(this.currentStateIndex);
        }
    }

    /**
     * Completely clear the canvas
     */
    clearCanvas() {
        // Clear the canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Reset history
        this.drawingStates = [];
        this.currentStateIndex = -1;
        this.operationStack = [];
        this.undoStack = [];

        // Save the blank state
        this.saveState();
    }

    // ===== TOOL SETTINGS =====

    /**
     * Change which tool is active
     * 
     * @param {string} tool - 'brush' or 'eraser'
     */
    setTool(tool) {
        this.currentTool = tool;
    }

    /**
     * Change brush color
     * 
     * @param {string} color - Hex color like '#FF0000'
     */
    setColor(color) {
        this.currentColor = color;
    }

    /**
     * Change brush size
     * 
     * @param {number} size - Size in pixels
     */
    setBrushSize(size) {
        this.brushSize = parseInt(size);
    }

    /**
     * Change eraser size
     * 
     * @param {number} size - Size in pixels
     */
    setEraserSize(size) {
        this.eraserSize = parseInt(size);
    }

    // ===== HISTORY REPLAY =====

    /**
     * Replay drawing history
     * 
     * Called when new user joins - replays all previous drawings
     * so they see everything that was drawn before.
     * 
     * @param {Array} drawingHistory - All previous operations
     */
    loadDrawingHistory(drawingHistory) {
        // Clear current canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Replay each operation
        drawingHistory.forEach(operation => {
            if (operation.type === 'DRAW') {
                this.remoteDrawBrush(
                    operation.x0,
                    operation.y0,
                    operation.x1,
                    operation.y1,
                    operation.color,
                    operation.size
                );
            } else if (operation.type === 'ERASE') {
                this.remoteErase(
                    operation.x0,
                    operation.y0,
                    operation.x1,
                    operation.y1,
                    operation.size
                );
            }
        });

        // Save this as our baseline state
        this.drawingStates = [this.canvas.toDataURL()];
        this.currentStateIndex = 0;
        this.updateUndoRedoButtons();
    }

    /**
     * Get current canvas as image data
     * 
     * @returns {string} - Data URL of canvas
     */
    getCanvasState() {
        return this.canvas.toDataURL();
    }

    /**
     * Export canvas as downloadable PNG image
     */
    exportAsImage() {
        const link = document.createElement('a');
        link.href = this.canvas.toDataURL('image/png');
        link.download = `canvas-${Date.now()}.png`;
        link.click();
    }
}