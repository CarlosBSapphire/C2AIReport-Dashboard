<?php
// cache.php
// Simple PHP session-based caching system for API responses

session_start();

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Initialize cache in session if not exists
if (!isset($_SESSION['cache'])) {
    $_SESSION['cache'] = [];
}

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'GET':
        // Get cached value
        $key = $_GET['key'] ?? '';
        $maxAge = isset($_GET['maxAge']) ? intval($_GET['maxAge']) : 300000; // Default 5 minutes
        
        if (empty($key)) {
            echo json_encode(['error' => 'Key is required']);
            http_response_code(400);
            exit();
        }
        
        if (isset($_SESSION['cache'][$key])) {
            $cached = $_SESSION['cache'][$key];
            $age = (time() * 1000) - $cached['timestamp'];
            
            if ($age < $maxAge) {
                echo json_encode([
                    'success' => true,
                    'data' => $cached['value'],
                    'age' => $age
                ]);
            } else {
                // Cache expired
                unset($_SESSION['cache'][$key]);
                echo json_encode([
                    'success' => false,
                    'message' => 'Cache expired'
                ]);
            }
        } else {
            echo json_encode([
                'success' => false,
                'message' => 'Cache not found'
            ]);
        }
        break;
        
    case 'POST':
        // Set cache value
        $key = $input['key'] ?? '';
        $value = $input['value'] ?? null;
        
        if (empty($key)) {
            echo json_encode(['error' => 'Key is required']);
            http_response_code(400);
            exit();
        }
        
        $_SESSION['cache'][$key] = [
            'value' => $value,
            'timestamp' => time() * 1000 // Milliseconds
        ];
        
        echo json_encode([
            'success' => true,
            'message' => 'Cache set successfully'
        ]);
        break;
        
    case 'DELETE':
        // Clear cache
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
        
    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
        break;
}
?>