const { v4: uuidv4 } = require('uuid');

/**
 * DrawingState Class
 * 
 * This class is responsible for maintaining the complete drawing history
 * and managing undo/redo operations in a collaborative drawing session.
 * 
 * Think of it as a "tape recorder" that records every drawing action
 * and allows us to replay or remove actions as needed.
 */
class DrawingState {
    constructor() {
        // Array storing all drawing operations (brush strokes and eraser actions)
        // Each element represents one action on the canvas
        this.drawingHistory = [];

        // Records of undo/redo operations for audit trail
        this.operationHistory = [];

        // Stack for operations that user can undo
        this.operationStack = [];

        // Stack for operations that user can redo
        this.redoStack = [];

        // Prevent memory overflow by limiting stored operations
        // After this many operations, we start removing oldest ones
        this.maxHistorySize = 500;

        // Track when this drawing session was created
        this.createdAt = Date.now();
    }

    /**
     * Add a new drawing or erasing operation to the history
     * 
     * This is called whenever a user draws a stroke or erases part of canvas.
     * We validate it first, then store it for later replay to new users.
     * 
     * @param {Object} operation - The drawing action
     *   - type: 'DRAW' or 'ERASE' (what action)
     *   - userId: who performed this action
     *   - x0, y0: starting coordinates
     *   - x1, y1: ending coordinates
     *   - color: for DRAW operations (what color)
     *   - size: brush/eraser size
     *   - timestamp: when it happened (for ordering)
     * 
     * @returns {boolean} - True if successfully added, false if invalid
     */
    addOperation(operation) {
        // Step 1: Validate the operation is correct format
        if (!this.validateOperation(operation)) {
            console.error('Invalid operation received:', operation);
            return false;
        }

        // Step 2: Add a unique ID if not already present
        const enrichedOp = {
            ...operation,
            id: operation.operationId || uuidv4(),
            addedAt: Date.now() // Server timestamp
        };

        // Step 3: Store in drawing history for future users to see
        this.drawingHistory.push(enrichedOp);

        // Step 4: Keep memory in check - if too many operations, remove oldest
        if (this.drawingHistory.length > this.maxHistorySize) {
            // Remove the first (oldest) operation
            this.drawingHistory.shift();
        }

        // Step 5: Track in operation stack for undo capability
        this.operationStack.push(operation);

        // Step 6: Clear redo stack when new operation happens
        // (Can't redo after new action - it breaks the timeline)
        this.redoStack = [];

        return true;
    }

    /**
     * Handle undo operation - remove last action from history
     * 
     * When a user presses Ctrl+Z, we remove that operation from the history.
     * All connected clients will replay the remaining operations.
     * 
     * Example: If we had [Draw Circle, Draw Square, Draw Triangle]
     *          After undo becomes: [Draw Circle, Draw Square]
     * 
     * @param {Object} undoOp - The undo request
     * @returns {boolean} - True if successfully undone
     */
    recordUndo(undoOp) {
        // Find the operation to remove by its ID
        const operationIndex = this.drawingHistory.findIndex(
            op => op.id === undoOp.operationId
        );

        // If operation not found, undo failed
        if (operationIndex === -1) {
            console.warn('Undo failed - operation not found:', undoOp.operationId);
            return false;
        }

        // Remove the operation from history
        const removedOperation = this.drawingHistory.splice(operationIndex, 1)[0];

        // Keep removed operation in case user wants to redo
        this.redoStack.push(removedOperation);

        // Record this undo action in audit trail
        this.operationHistory.push({
            type: 'UNDO',
            ...undoOp,
            removedOperationId: undoOp.operationId,
            timestamp: Date.now()
        });

        return true;
    }

    /**
     * Handle redo operation - restore previously undone action
     * 
     * When a user presses Ctrl+Y, we add back the last removed operation.
     * 
     * @param {Object} redoOp - The redo request
     * @returns {boolean} - True if successfully redone
     */
    recordRedo(redoOp) {
        // Check if there's actually something to redo
        if (this.redoStack.length === 0) {
            console.warn('Redo failed - nothing to redo');
            return false;
        }

        // Get the operation to restore
        const operation = this.redoStack.pop();

        // Add it back to the drawing history
        this.drawingHistory.push(operation);

        // Record this redo action in audit trail
        this.operationHistory.push({
            type: 'REDO',
            ...redoOp,
            readdedOperationId: operation.id,
            timestamp: Date.now()
        });

        return true;
    }

    /**
     * Get the complete drawing history
     * 
     * This is sent to new users when they join, so they can see
     * all previous drawings without waiting for live updates.
     * 
     * @returns {Array} - Snapshot of current drawing history
     */
    getHistory() {
        // Return a copy to prevent external modifications
        return [...this.drawingHistory];
    }

    /**
     * Get the operation history (undo/redo records)
     * 
     * Useful for debugging and understanding what actions were taken.
     * 
     * @returns {Array} - All undo/redo operations
     */
    getOperationHistory() {
        return [...this.operationHistory];
    }

    /**
     * Find all operations performed by a specific user
     * 
     * @param {string} userId - The user to search for
     * @returns {Array} - All operations by this user
     */
    getUserOperations(userId) {
        return this.drawingHistory.filter(op => op.userId === userId);
    }

    /**
     * Get operations within a specific time window
     * 
     * Useful for analyzing activity during specific periods.
     * 
     * @param {number} startTime - Unix timestamp
     * @param {number} endTime - Unix timestamp
     * @returns {Array} - Operations in that time range
     */
    getOperationsBetween(startTime, endTime) {
        return this.drawingHistory.filter(
            op => op.timestamp >= startTime && op.timestamp <= endTime
        );
    }

    /**
     * Wipe all drawing data
     * 
     * Called when user clicks "Clear Canvas" button.
     * Resets everything to initial state.
     */
    clear() {
        this.drawingHistory = [];
        this.operationHistory = [];
        this.operationStack = [];
        this.redoStack = [];
    }

    /**
     * Validate that an operation has all required fields and correct format
     * 
     * Think of this as a quality checker - making sure we don't store garbage.
     * 
     * @param {Object} operation - The operation to validate
     * @returns {boolean} - True if valid, false if missing fields or wrong type
     */
    validateOperation(operation) {
        // Check if all required base fields are present
        const requiredBaseFields = ['type', 'userId', 'timestamp'];

        for (const field of requiredBaseFields) {
            if (!(field in operation)) {
                console.error(`Validation failed: missing required field "${field}"`);
                return false;
            }
        }

        // Only allow these operation types
        const validTypes = ['DRAW', 'ERASE', 'CLEAR_CANVAS'];
        if (!validTypes.includes(operation.type)) {
            console.error(`Validation failed: invalid operation type "${operation.type}"`);
            return false;
        }

        // DRAW operations need coordinates and appearance info
        if (operation.type === 'DRAW') {
            const requiredDrawFields = ['x0', 'y0', 'x1', 'y1', 'color', 'size'];
            for (const field of requiredDrawFields) {
                if (!(field in operation)) {
                    console.error(`Validation failed: DRAW missing "${field}"`);
                    return false;
                }
            }
        }

        // ERASE operations need coordinates and size
        if (operation.type === 'ERASE') {
            const requiredEraseFields = ['x0', 'y0', 'x1', 'y1', 'size'];
            for (const field of requiredEraseFields) {
                if (!(field in operation)) {
                    console.error(`Validation failed: ERASE missing "${field}"`);
                    return false;
                }
            }
        }

        // All checks passed!
        return true;
    }

    /**
     * Generate statistics about the current drawing state
     * 
     * Useful for debugging and monitoring what's happening.
     * 
     * @returns {Object} - Statistics about operations and performance
     */
    getStats() {
        // Count different operation types
        const drawCount = this.drawingHistory.filter(op => op.type === 'DRAW').length;
        const eraseCount = this.drawingHistory.filter(op => op.type === 'ERASE').length;

        // Count unique users who have drawn
        const uniqueUsers = new Set(this.drawingHistory.map(op => op.userId));

        return {
            totalOperations: this.drawingHistory.length,
            drawOperations: drawCount,
            eraseOperations: eraseCount,
            undoOperations: this.operationHistory.filter(op => op.type === 'UNDO').length,
            redoOperations: this.operationHistory.filter(op => op.type === 'REDO').length,
            uniqueUsers: uniqueUsers.size,
            createdAt: this.createdAt,
            uptime: Date.now() - this.createdAt,
            memoryUsageKB: JSON.stringify(this.drawingHistory).length / 1024
        };
    }

    /**
     * Export all drawing state as JSON
     * 
     * Could be used to save drawing sessions to a database or file.
     * 
     * @returns {Object} - Complete state snapshot
     */
    export() {
        return {
            drawingHistory: this.getHistory(),
            operationHistory: this.getOperationHistory(),
            stats: this.getStats(),
            exportedAt: Date.now()
        };
    }

    /**
     * Import previously saved drawing state
     * 
     * Restores a previously exported state.
     * 
     * @param {Object} data - The data to import
     */
    import(data) {
        // Only import if it looks like valid data
        if (data.drawingHistory && Array.isArray(data.drawingHistory)) {
            this.drawingHistory = data.drawingHistory;
        }
        if (data.operationHistory && Array.isArray(data.operationHistory)) {
            this.operationHistory = data.operationHistory;
        }
    }

    /**
     * Compress history to free up memory
     * 
     * If we're running low on memory, remove oldest operations
     * while keeping recent ones for undo/redo.
     * 
     * @returns {Object} - Report of what was removed
     */
    compress() {
        const originalSize = this.drawingHistory.length;

        // Keep only the most recent 70% of operations
        const maxSize = Math.floor(this.maxHistorySize * 0.7);

        if (this.drawingHistory.length > maxSize) {
            // Remove from the beginning (oldest operations)
            this.drawingHistory = this.drawingHistory.slice(-maxSize);
        }

        const newSize = this.drawingHistory.length;
        console.log(`Compressed history: ${originalSize} → ${newSize} operations`);

        return {
            originalSize,
            newSize,
            operationsRemoved: originalSize - newSize
        };
    }
}

module.exports = DrawingState;