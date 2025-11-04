<?php
function cache_get_or_set(string $key, callable $callback, int $ttl_seconds = 0) {
    $cache_key = 'cache_' . $key;

    // Check for existing, non-expired data
    if (isset($_SESSION[$cache_key])) {
        $cached_data = $_SESSION[$cache_key];

        // Check TTL if set
        if ($ttl_seconds > 0) {
            if (time() < $cached_data['timestamp'] + $ttl_seconds) {
                // Cache hit
                error_log("Data retrieved from session cache for key: " . $key);
                return $cached_data['data'];
            }
            // Cache expired
            unset($_SESSION[$cache_key]);
        } else {
            // Cache hit (no expiry)
            error_log("Data retrieved from session cache for key: " . $key . " (no expiry)");
            return $cached_data['data'];
        }
    }

    // Cache miss or expired, run the callback to generate data
    error_log("Cache miss. Generating and storing data for key: " . $key);
    $data = $callback();

    // Store the new data in the session
    $_SESSION[$cache_key] = [
        'data' => $data,
        'timestamp' => time()
    ];

    return $data;
}

// --- Operation to be Cached (The "Slow" Part) ---

/**
 * Simulates fetching complex data, like a heavy database query or external API call.
 */
function get_complex_dashboard_data() {
    // Simulate a slow operation (e.g., waiting for 3 seconds)
    sleep(3);
    
    // The actual data you want to cache
    return [
        'total_revenue' => 125000 + rand(0, 1000), // Randomize slightly for proof of freshness
        'query_time' => date('H:i:s')
    ];
}

// --- Main Application Logic ---

// Cache the dashboard data for 10 minutes (600 seconds)
$dashboard_data = cache_get_or_set(
    'user_dashboard_stats',
    'get_complex_dashboard_data',
    600 // TTL of 10 minutes
);

?>