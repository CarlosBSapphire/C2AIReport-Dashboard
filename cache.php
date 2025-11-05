<?php
/**
 * ============================================================================
 * SESSION-BASED CACHE SYSTEM
 * ============================================================================
 * 
 * Provides a simple PHP session-based caching mechanism for API responses.
 * Reduces redundant API calls and improves application performance.
 * 
 * @file cache.php
 * @version 2.0.0
 * 
 * FEATURES:
 * ---------
 * - Session-based storage (survives page reloads within session)
 * - Age-based cache expiration
 * - RESTful API design (GET, POST, DELETE)
 * - CORS support for cross-origin requests
 * - JSON response format
 * 
 * API ENDPOINTS:
 * --------------
 * GET     /?key={key}&maxAge={milliseconds}  - Retrieve cached data
 * POST    /                                   - Store data in cache
 * DELETE  /                                   - Clear cache (specific key or all)
 * 
 * USAGE EXAMPLES:
 * ---------------
 * // Store data
 * fetch('/cache.php', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ key: 'users', value: [...] })
 * });
 * 
 * // Retrieve data
 * fetch('/cache.php?key=users&maxAge=300000')
 *     .then(r => r.json())
 *     .then(data => console.log(data));
 * 
 * // Clear specific key
 * fetch('/cache.php', {
 *     method: 'DELETE',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ key: 'users' })
 * });
 * 
 * // Clear all cache
 * fetch('/cache.php', {
 *     method: 'DELETE',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({})
 * });
 * 
 * ============================================================================
 */

// Start PHP session for persistent storage
session_start();

// ============================================================================
// SECTION: HTTP Headers Configuration
// ============================================================================

/**
 * Set response headers for JSON API and CORS support
 */
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

/**
 * Handle CORS preflight requests
 * 
 * OPTIONS requests are sent by browsers before actual requests
 * to check if the server accepts the origin and method.
 */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ============================================================================
// SECTION: Cache Initialization
// ============================================================================

/**
 * Initialize cache structure in session
 * 
 * Creates the cache array if it doesn't exist.
 * Fixed: Removed incorrect condition (!empty) that prevented initialization.
 */
if (!isset($_SESSION['cache'])) {
    $_SESSION['cache'] = [];
}

// ============================================================================
// SECTION: Request Processing
// ============================================================================

// Get HTTP method and request body
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

/**
 * Route request to appropriate handler based on HTTP method
 */
switch ($method) {
    
    // ========================================================================
    // GET: Retrieve cached data
    // ========================================================================
    case 'GET':
        /**
         * Retrieve cached value if it exists and hasn't expired
         * 
         * Query Parameters:
         * @param string $key - Cache key identifier
         * @param int $maxAge - Maximum age in milliseconds (default: 300000 = 5 minutes)
         * 
         * Response Format:
         * Success: { success: true, data: mixed, age: int }
         * Expired: { success: false, message: "Cache expired" }
         * Not Found: { success: false, message: "Cache not found" }
         */
        $key = $_GET['key'] ?? '';
        $maxAge = isset($_GET['maxAge']) ? intval($_GET['maxAge']) : 300000;
        
        // Validate required parameters
        if (empty($key)) {
            echo json_encode([
                'success' => false,
                'error' => 'Key parameter is required'
            ]);
            http_response_code(400);
            exit();
        }
        
        // Check if key exists in cache
        if (isset($_SESSION['cache'][$key])) {
            $cached = $_SESSION['cache'][$key];
            $age = (time() * 1000) - $cached['timestamp'];
            
            // Check if cache is still valid
            if ($age < $maxAge) {
                echo json_encode([
                    'success' => true,
                    'data' => $cached['value'],
                    'age' => $age
                ]);
            } else {
                // Cache expired - remove it
                unset($_SESSION['cache'][$key]);
                echo json_encode([
                    'success' => false,
                    'message' => 'Cache expired'
                ]);
            }
        } else {
            // Key not found in cache
            echo json_encode([
                'success' => false,
                'message' => 'Cache not found'
            ]);
        }
        break;
        
    // ========================================================================
    // POST: Store data in cache
    // ========================================================================
    case 'POST':
        /**
         * Store a value in the cache with current timestamp
         * 
         * Request Body:
         * @param string $key - Cache key identifier
         * @param mixed $value - Data to cache (any JSON-serializable value)
         * 
         * Response Format:
         * Success: { success: true, message: "Cache set successfully" }
         * Error: { success: false, error: "Key is required" }
         */
        $key = $input['key'] ?? '';
        $value = $input['value'] ?? null;
        
        // Validate required parameters
        if (empty($key)) {
            echo json_encode([
                'success' => false,
                'error' => 'Key parameter is required'
            ]);
            http_response_code(400);
            exit();
        }
        
        // Store value with timestamp
        $_SESSION['cache'][$key] = [
            'value' => $value,
            'timestamp' => time() * 1000 // Store in milliseconds
        ];
        
        echo json_encode([
            'success' => true,
            'message' => 'Cache set successfully'
        ]);
        break;
        
    // ========================================================================
    // DELETE: Clear cache
    // ========================================================================
    case 'DELETE':
        /**
         * Clear cache data
         * 
         * If key is provided, clears only that key.
         * If key is null/empty, clears entire cache.
         * 
         * Request Body:
         * @param string|null $key - Specific key to clear, or null for all
         * 
         * Response Format:
         * Success: { success: true, message: "Cache [key] cleared" }
         * Not Found: { success: false, message: "Cache key not found" }
         */
        $key = $input['key'] ?? null;
        
        if ($key) {
            // Clear specific key
            if (isset($_SESSION['cache'][$key])) {
                unset($_SESSION['cache'][$key]);
                echo json_encode([
                    'success' => true,
                    'message' => 'Cache key cleared'
                ]);
            } else {
                echo json_encode([
                    'success' => false,
                    'message' => 'Cache key not found'
                ]);
            }
        } else {
            // Clear all cache
            $_SESSION['cache'] = [];
            echo json_encode([
                'success' => true,
                'message' => 'All cache cleared'
            ]);
        }
        break;
        
    // ========================================================================
    // Invalid Method
    // ========================================================================
    default:
        /**
         * Handle unsupported HTTP methods
         */
        http_response_code(405);
        echo json_encode([
            'success' => false,
            'error' => 'Method not allowed. Supported methods: GET, POST, DELETE'
        ]);
        break;
}

/**
 * ============================================================================
 * END OF CACHE SYSTEM
 * ============================================================================
 */
?>