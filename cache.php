<?php
// cache.php - Enhanced version with file-based caching
// Enable gzip compression
if (!ob_start('ob_gzhandler')) {
    ob_start();
}

// Add compression header
header('Content-Encoding: gzip');

session_start();


// Configuration
define('CACHE_DIR', __DIR__ . '/cache/');
define('USE_FILE_CACHE', true); // Toggle file caching

// Ensure cache directory exists
if (USE_FILE_CACHE && !is_dir(CACHE_DIR)) {
    mkdir(CACHE_DIR, 0755, true);
}

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Initialize session cache
if (!isset($_SESSION['cache'])) {
    $_SESSION['cache'] = [];
}

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'GET':
        $key = $_GET['key'] ?? '';
        $maxAge = isset($_GET['maxAge']) ? intval($_GET['maxAge']) : 300000;
        
        if (empty($key)) {
            echo json_encode(['success' => false, 'error' => 'Key required']);
            http_response_code(400);
            exit();
        }
        
        // Try session cache first (fastest)
        if (isset($_SESSION['cache'][$key])) {
            $cached = $_SESSION['cache'][$key];
            $age = (time() * 1000) - $cached['timestamp'];
            
            if ($age < $maxAge) {
                echo json_encode([
                    'success' => true,
                    'data' => $cached['value'],
                    'age' => $age,
                    'source' => 'session'
                ]);
                exit();
            } else {
                unset($_SESSION['cache'][$key]);
            }
        }
        
        // Try file cache (survives session)
        if (USE_FILE_CACHE) {
            $cacheFile = CACHE_DIR . md5($key) . '.cache';
            
            if (file_exists($cacheFile)) {
                $cached = json_decode(file_get_contents($cacheFile), true);
                $age = (time() * 1000) - $cached['timestamp'];
                
                if ($age < $maxAge) {
                    // Load into session for faster subsequent access
                    $_SESSION['cache'][$key] = $cached;
                    
                    echo json_encode([
                        'success' => true,
                        'data' => $cached['value'],
                        'age' => $age,
                        'source' => 'file'
                    ]);
                    exit();
                } else {
                    unlink($cacheFile); // Delete expired cache
                }
            }
        }
        
        echo json_encode(['success' => false, 'message' => 'Cache not found']);
        break;
        
    case 'POST':
        $key = $input['key'] ?? '';
        $value = $input['value'] ?? null;
        $persist = $input['persist'] ?? true; // New option
        
        if (empty($key)) {
            echo json_encode(['success' => false, 'error' => 'Key required']);
            http_response_code(400);
            exit();
        }
        
        $cacheData = [
            'value' => $value,
            'timestamp' => time() * 1000
        ];
        
        // Store in session
        $_SESSION['cache'][$key] = $cacheData;
        
        // Optionally persist to file
        if (USE_FILE_CACHE && $persist) {
            $cacheFile = CACHE_DIR . md5($key) . '.cache';
            file_put_contents($cacheFile, json_encode($cacheData));
        }
        
        echo json_encode(['success' => true, 'message' => 'Cache set']);
        break;
        
    case 'DELETE':
        $key = $input['key'] ?? null;
        
        if ($key) {
            // Clear specific key from both session and file
            unset($_SESSION['cache'][$key]);
            
            if (USE_FILE_CACHE) {
                $cacheFile = CACHE_DIR . md5($key) . '.cache';
                if (file_exists($cacheFile)) {
                    unlink($cacheFile);
                }
            }
            
            echo json_encode(['success' => true, 'message' => 'Cache cleared']);
        } else {
            // Clear all cache
            $_SESSION['cache'] = [];
            
            if (USE_FILE_CACHE) {
                $files = glob(CACHE_DIR . '*.cache');
                foreach ($files as $file) {
                    unlink($file);
                }
            }
            
            echo json_encode(['success' => true, 'message' => 'All cache cleared']);
        }
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Method not allowed']);
        break;
}

?>