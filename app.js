/**
 * ============================================================================
 * CLIENT REVENUE DASHBOARD - Main Application
 * ============================================================================
 * 
 * This application provides a comprehensive revenue tracking dashboard for
 * monitoring client usage across multiple service categories (emails, chats,
 * calls, and manual packages).
 * 
 * @file app.js
 * @version 2.0.0
 * @requires Chart.js v4.4.9
 * @requires chartjs-plugin-trendline
 * 
 * ARCHITECTURE OVERVIEW:
 * ----------------------
 * 1. Data Fetching: Retrieves data from API endpoint with session caching
 * 2. Revenue Calculation: Aggregates revenue across multiple service types
 * 3. Visualization: Displays data using Chart.js (line, bar, radar charts)
 * 4. User Interaction: Provides drill-down capabilities for detailed analysis
 * 
 * DATA FLOW:
 * ----------
 * API -> Cache -> Aggregation -> Chart Rendering -> User Interaction
 * 
 * ============================================================================
 */

// ============================================================================
// SECTION: Global Configuration & State
// ============================================================================

/**
 * API endpoint for data fetching
 * @constant {string}
 */
const API_ENDPOINT = "https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb";

/**
 * Cache endpoint for session-based data caching
 * @constant {string}
 */
const CACHE_ENDPOINT = "/cache.php";

/**
 * Chart instance for individual user detail view
 * @type {Chart|null}
 */
let chartInstance = null;

/**
 * Chart instance for main aggregate revenue view
 * @type {Chart|null}
 */
let mainChartInstance = null;

/**
 * Chart instance for radar breakdown visualization
 * @type {Chart|null}
 */
let radarChartInstance = null;

/**
 * Currently selected user object
 * @type {Object|null}
 */
let currentUser = null;

/**
 * Start date for current data query (ISO format: YYYY-MM-DD)
 * @type {string|null}
 */
let currentStartDate = null;

/**
 * End date for current data query (ISO format: YYYY-MM-DD)
 * @type {string|null}
 */
let currentEndDate = null;

/**
 * Current date aggregation type
 * @type {string|null}
 * @values '1' = Daily, '7' = Weekly, '30' = Monthly
 */
let currentDateType = null;

//!SECTION

// ============================================================================
// SECTION: Session Cache Management
// ============================================================================

/**
 * PHP-based session cache for API response data
 * 
 * Provides methods to set, get, and clear cached data to reduce API calls
 * and improve application performance.
 * 
 * @namespace sessionCache
 */
const sessionCache = {
    /**
     * Store a value in the session cache
     * 
     * @async
     * @param {string} key - Unique identifier for cached data
     * @param {*} value - Data to cache (will be JSON stringified)
     * @returns {Promise<boolean>} True if successful, false otherwise
     * 
     * @example
     * await sessionCache.set('users_data', usersArray);
     */
    async set(key, value) {
        try {
            const response = await fetch(CACHE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key, value })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error("Cache set error:", error);
            return false;
        }
    },
    
    /**
     * Retrieve a value from the session cache
     * 
     * @async
     * @param {string} key - Unique identifier for cached data
     * @param {number} [maxAge=300000] - Maximum age in milliseconds (default: 5 minutes)
     * @returns {Promise<*|null>} Cached data if valid, null if expired or not found
     * 
     * @example
     * const cachedUsers = await sessionCache.get('users_data', 600000);
     */
    async get(key, maxAge = 300000) {
        try {
            const response = await fetch(`${CACHE_ENDPOINT}?key=${encodeURIComponent(key)}&maxAge=${maxAge}`);
            const result = await response.json();
            return result.success ? result.data : null;
        } catch (error) {
            console.error("Cache get error:", error);
            return null;
        }
    },
    
    /**
     * Clear cached data
     * 
     * @async
     * @param {string|null} [key=null] - Specific key to clear, or null to clear all
     * @returns {Promise<boolean>} True if successful, false otherwise
     * 
     * @example
     * await sessionCache.clear(); // Clear all cache
     * await sessionCache.clear('users_data'); // Clear specific key
     */
    async clear(key = null) {
        try {
            const response = await fetch(CACHE_ENDPOINT, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error("Cache clear error:", error);
            return false;
        }
    }
};

//!SECTION

// ============================================================================
// SECTION: Date Helper Functions
// ============================================================================

/**
 * Format a Date object to ISO date string (YYYY-MM-DD)
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date string
 * 
 * @example
 * formatDate(new Date('2024-12-25')) // Returns '2024-12-25'
 */
const formatDate = (date) => {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}

/**
 * Get the most recent Sunday (start of week)
 * 
 * @returns {Date} Date object representing last Sunday
 * 
 * @example
 * getLastSunday() // Returns Date for most recent Sunday
 */
const getLastSunday = () => {
    const today = new Date();
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - today.getDay());
    return lastSunday;
}

/**
 * Generate an array of all dates between start and end (inclusive)
 * 
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {string[]} Array of date strings in YYYY-MM-DD format
 * 
 * @example
 * getDatesInRange('2024-01-01', '2024-01-03')
 * // Returns ['2024-01-01', '2024-01-02', '2024-01-03']
 */
const getDatesInRange = (startDate, endDate) => {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
        dates.push(formatDate(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

/**
 * Add a specified number of days to a date string
 * 
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {number} days - Number of days to add (can be negative)
 * @returns {string} New date string in YYYY-MM-DD format
 * 
 * @example
 * addDaysToDate('2024-01-01', 7) // Returns '2024-01-08'
 */
const addDaysToDate = (dateString, days) => {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return formatDate(date);
}

//!SECTION

// ============================================================================
// SECTION: Data Fetching with Caching
// ============================================================================

/**
 * Fetch data from API with automatic caching and date filtering
 * 
 * This function handles all API communication, including:
 * - Cache checking and storage
 * - Date range filtering
 * - Error handling and logging
 * - Response parsing and normalization
 * 
 * @async
 * @param {string} tableName - Name of the database table to query
 * @param {string[]} columns - Array of column names to retrieve
 * @param {Object} [filters={}] - Additional filters to apply
 * @returns {Promise<Array>} Array of data rows from the table
 * 
 * @throws {Error} If API request fails or returns invalid data
 * 
 * @example
 * const users = await fetchData("users", ["id", "first_name", "last_name"], { role: "user" });
 */
async function fetchData(tableName, columns, filters = {}) {
    const cacheKey = JSON.stringify({ tableName, columns, filters });
    
    // Check cache first
    const cached = await sessionCache.get(cacheKey);
    if (cached) {
        console.log(`Using cached data for: ${tableName}`);
        return cached;
    }
    
    console.log(`Fetching data from table: ${tableName} with filters:`, filters);
    
    // Add date filters based on table name
    const enhancedFilters = { ...filters };
    if (currentStartDate && currentEndDate) {
        // Map table names to their date columns
        const dateColumnMap = {
            'Daily_Email_Cost_Record': 'created_date',
            'Daily_Chat_Record_Cost_Record': 'created_date',
            'Daily_Calls_Cost_Record': 'created_date',
            'AI_Email_Records': 'updated_at',
            'Call_Data': 'created_at',
            'AI_Chat_Data': 'created_date'
        };
        // REVIEW if we add more packages or services then this needs to mannualy created
        
        const dateColumn = dateColumnMap[tableName];
        if (dateColumn) {
            enhancedFilters[`${dateColumn}_after`] = currentStartDate;
            enhancedFilters[`${dateColumn}_before`] = currentEndDate;
        }
    }
    
    const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_name: tableName, columns, filters: enhancedFilters })
    });

    if (!response.ok) {
        console.error(`HTTP Error for ${tableName}: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch ${tableName} data: ${response.statusText}`);
    }

    const text = await response.text();
    
    if (!text || text.trim().length === 0) {
        console.warn(`Empty response body received from table: ${tableName}`);
        return [];
    }
    
    let result;
    try {
        result = JSON.parse(text);
        console.log(`Data fetched from table: ${tableName}`, result);
    } catch (e) {
        console.error(`Error parsing JSON from table: ${tableName}. Raw text: ${text}`, e);
        return []; 
    }
    
    // Normalize response format
    let finalData = [];
    if (Array.isArray(result)) {
        finalData = result;
    } else if (result && typeof result === "object") {
        finalData = result.rows || result.data || result.result || [];
    }
    
    // Cache the result
    await sessionCache.set(cacheKey, finalData);
    
    return finalData;
}

//!SECTION

// ============================================================================
// SECTION: Package Statistics Functions
// ============================================================================

/**
 * Calculate package statistics for a specific user
 * 
 * Retrieves all manual charges (packages) for a user and calculates:
 * - Total number of packages
 * - Total weekly revenue from packages (accounting for frequency)
 * - Comma-separated list of package names
 * 
 * @async
 * @param {number|string} userId - User ID to query
 * @returns {Promise<Object>} Package statistics object
 * @returns {number} .packageCount - Number of packages
 * @returns {number} .weeklyPackageRevenue - Total weekly revenue
 * @returns {string} .packageNames - Comma-separated package names
 * @returns {Array} .packages - Raw package data array
 * 
 * @example
 * const stats = await getPackageStatsForUser(123);
 * console.log(stats.weeklyPackageRevenue); // 150.00
 */
async function getPackageStatsForUser(userId) {
    const packages = await fetchData("manual_charges", ["user_id", "cost", "name", "frequency"], { user_id: userId });
    const packageCount = packages.length;
    
    // Calculate total weekly revenue considering package frequency
    const weeklyPackageRevenue = packages.reduce((sum, pkg) => {
        return sum + (parseFloat(pkg.cost) || 0);
    }, 0);
    
    const packageNames = packages.map(pkg => pkg.name).filter(n => n).join(', ') || 'None';
    
    return { packageCount, weeklyPackageRevenue, packageNames, packages };
}

/**
 * Get detailed revenue breakdown by date for a specific user
 * 
 * This function aggregates revenue across all service categories:
 * - Manual packages (prorated daily based on frequency)
 * - Email overages (beyond threshold)
 * - Chat conversations
 * - Call minutes
 * 
 * @async
 * @param {number|string} userId - User ID to query
 * @param {string[]} dates - Array of dates to calculate revenue for
 * @returns {Promise<Object>} Revenue by date object
 * @returns {Object} .[date] - Revenue for each date
 * @returns {number} .[date].packages - Package revenue
 * @returns {number} .[date].emails - Email revenue
 * @returns {number} .[date].chats - Chat revenue
 * @returns {number} .[date].calls - Call revenue
 * REVIEW if we add more packages or services then this needs to mannualy created
 * 
 * @example
 * const revenue = await getRevenueByDateForUser(123, ['2024-01-01', '2024-01-02']);
 * console.log(revenue['2024-01-01'].packages); // 5.71 (daily proration)
 */
async function getRevenueByDateForUser(userId, dates) {
    // Fetch all revenue data sources concurrently
    const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts] = await Promise.all([
        fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: userId }),
        fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: userId }),
        fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: userId }),
        fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: userId })
    ]);
    // REVIEW if we add more packages or services then this needs to mannualy created

    // Initialize revenue structure for all dates
    const revenueByDate = {};
    dates.forEach(date => {
        revenueByDate[date] = {
            packages: 0,
            emails: 0,
            chats: 0,
            calls: 0
        }; // REVIEW if we add more packages or services then this needs to mannualy created
    });

    // Calculate daily package cost (prorated from weekly/monthly)
    let totalPackageCostByDay = 0;
    packages.forEach(pkg => {
        let dailyPackageCost = 0;
        const packageCost = parseFloat(pkg.cost) || 0;
        
        if (pkg.frequency === 'Weekly') {
            // Weekly packages: divide by 7 days
            dailyPackageCost = packageCost / 7;
        } else if (pkg.frequency === 'Monthly') {
            // Monthly packages: divide by 30.5 days (average month length)
            dailyPackageCost = packageCost / 30.5;
        }
        
        totalPackageCostByDay += dailyPackageCost;
    });

    // Apply daily package cost to all dates
    dates.forEach(date => {
        revenueByDate[date].packages = totalPackageCostByDay;
    });

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    /**
     * Process email costs from weekly records
     * Email charges are based on overages beyond the package threshold
     */
    dailyEmailCosts.forEach(week => {
        const weekStartDate = week.created_date ? formatDate(new Date(week.created_date)) : null;
        if (!weekStartDate) return;
        
        daysOfWeek.forEach((day, index) => {
            const actualDate = addDaysToDate(weekStartDate, index);
            if (revenueByDate[actualDate] && week[day] && typeof week[day] === 'object') {
                const emails = week[day].emails || 0;
                const threshold = week[day].email_threshold || 0;
                const overage = Math.max(0, emails - threshold);
                const cost = overage * (week[day].email_cost_overage || 0);
                revenueByDate[actualDate].emails += cost;
            }
        });
    });

    /**
     * Process chat costs from weekly records
     * Chat charges are based on per-conversation costs or daily totals
     */
    dailyChatCosts.forEach(week => {
        const weekStartDate = week.created_date ? formatDate(new Date(week.created_date)) : null;
        if (!weekStartDate) return;
        
        daysOfWeek.forEach((day, index) => {
            const actualDate = addDaysToDate(weekStartDate, index);
            if (revenueByDate[actualDate] && week[day] && typeof week[day] === 'object') {
                const dailyCost = week[day].daily_cost || week[day].chats * (week[day].chat_per_conversation_cost || 0);
                revenueByDate[actualDate].chats += dailyCost || 0;
            }
        });
    });

    /**
     * Process call costs from weekly records
     * Call charges are based on minutes at a per-minute rate
     */
    dailyCallsCosts.forEach(week => {
        const weekStartDate = week.created_date ? formatDate(new Date(week.created_date)) : null;
        if (!weekStartDate) return;
        
        daysOfWeek.forEach((day, index) => {
            const actualDate = addDaysToDate(weekStartDate, index);
            if (revenueByDate[actualDate] && week[day] && typeof week[day] === 'object') {
                const cost = week[day].cost || week[day].daily_cost || (week[day].minutes || 0) * (week[day].cost_per_minute || 0);
                revenueByDate[actualDate].calls += cost || 0;
            }
        });
    });
    // REVIEW if we add more packages or services then this needs to mannualy created
    return revenueByDate;
}

/**
 * Calculate total revenue for a user across a date range
 * 
 * Sums all revenue categories for all dates in the specified range.
 * 
 * @async
 * @param {number|string} userId - User ID to query
 * @param {string[]} dates - Array of dates to sum
 * @returns {Promise<number>} Total revenue rounded to 2 decimal places
 * 
 * @example
 * const total = await getTotalRevenueForUser(123, ['2024-01-01', '2024-01-02']);
 * console.log(total); // 245.67
 */
async function getTotalRevenueForUser(userId, dates) {
    const revenueByDate = await getRevenueByDateForUser(userId, dates);
    let total = 0;
    dates.forEach(date => {
        const dayRevenue = revenueByDate[date];
        total += dayRevenue.packages + dayRevenue.emails + dayRevenue.chats + dayRevenue.calls;
    });
    return parseFloat(total.toFixed(2));
}

//!SECTION

// ============================================================================
// SECTION: Chart Color Configuration
// ============================================================================

/**
 * Get CSS custom property value from the root element
 * This allows charts to use the same color scheme as the rest of the application
 * and automatically adapt to light/dark mode
 * 
 * @param {string} propertyName - CSS custom property name (e.g., '--primary')
 * @returns {string} The computed CSS value
 */
function getCSSVariable(propertyName) {
    return getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
}

/**
 * Convert hex color to rgba with specified opacity
 * 
 * @param {string} hex - Hex color code (e.g., '#00356f')
 * @param {number} alpha - Opacity value 0-1
 * @returns {string} RGBA color string
 */
function hexToRgba(hex, alpha) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Standardized color scheme for all charts
 * Uses CSS custom properties from styles.css for theme consistency
 * Colors automatically adapt to light/dark mode
 * 
 * @constant {Object} chartColors
 */
const chartColors = {
    packages: {
        // Using --primary color (#00356f) from CSS
        get background() { return hexToRgba(getCSSVariable('--primary'), 0.2); },
        get border() { return getCSSVariable('--primary'); },
        get point() { return getCSSVariable('--primary'); }
    },
    emails: {
        // Using --pending color (#f59e0b) from CSS - amber/warning
        get background() { return hexToRgba(getCSSVariable('--pending'), 0.2); },
        get border() { return getCSSVariable('--pending'); },
        get point() { return getCSSVariable('--pending'); }
    },
    chats: {
        // Using --secondary color (#008387) from CSS - teal
        get background() { return hexToRgba(getCSSVariable('--secondary'), 0.2); },
        get border() { return getCSSVariable('--secondary'); },
        get point() { return getCSSVariable('--secondary'); }
    },
    calls: {
        // Using --info color (#2563eb or #3b82f6) from CSS - blue
        get background() { return hexToRgba(getCSSVariable('--info'), 0.2); },
        get border() { return getCSSVariable('--info'); },
        get point() { return getCSSVariable('--info'); }
    }
    // REVIEW if we add more packages or services then this needs to mannualy created
};

//!SECTION

// ============================================================================
// SECTION: Radar Chart for Revenue Breakdown
// ============================================================================

/**
 * Display radar chart showing revenue breakdown by user and type
 * 
 * Creates a multi-dataset radar chart where:
 * - Each axis represents a user
 * - Each dataset represents a revenue category (packages, emails, chats, calls)
 * - Allows visual comparison of revenue composition across users
 * 
 * @async
 * @param {Object} period - Period data object
 * @param {string[]} period.datesInPeriod - Array of dates in the period
 * @param {string} period.label - Display label for the period
 * @param {Array<Object>} users - Array of user objects
 * @returns {Promise<void>}
 * REVIEW if we add more packages or services then this needs to mannualy created
 * @example
 * await showRadarChart(
 *   { datesInPeriod: ['2024-01-01'], label: '2024-01-01' },
 *   [{ id: 1, first_name: 'John', last_name: 'Doe' }]
 * );
 */
async function showRadarChart(period, users) {
    const radarContainer = document.getElementById('radar-chart-container');
    const radarCanvas = document.getElementById('radar-chart');
    const datesInPeriod = period.datesInPeriod;
    
    // Format date display
    const dateDisplay = datesInPeriod.length > 1 
        ? `${datesInPeriod[0]} to ${datesInPeriod[datesInPeriod.length - 1]}` 
        : period.label;
    
    radarContainer.style.display = 'block';
    document.getElementById('radar-date').textContent = dateDisplay;
    
    // Destroy existing chart instance
    if (radarChartInstance) {
        radarChartInstance.destroy();
    }
    
    // Get all dates in current range for data aggregation
    const allDatesInCurrentRange = getDatesInRange(currentStartDate, currentEndDate);

    // Calculate revenue for each user in the period
    const userRevenuePromises = users.map(async (user) => {
        const revenueByDate = await getRevenueByDateForUser(user.id, allDatesInCurrentRange);
        let aggregatedRevenue = { packages: 0, emails: 0, chats: 0, calls: 0 }; // REVIEW if we add more packages or services then this needs to mannualy created
        
        // Sum revenue across all dates in the period
        datesInPeriod.forEach(date => {
            const dayRevenue = revenueByDate[date];
            if (dayRevenue) {
                aggregatedRevenue.packages += dayRevenue.packages;
                aggregatedRevenue.emails += dayRevenue.emails;
                aggregatedRevenue.chats += dayRevenue.chats;
                aggregatedRevenue.calls += dayRevenue.calls;
            }// REVIEW if we add more packages or services then this needs to mannualy created
        });
        
        return {
            userId: user.id,
            userName: `${user.first_name} ${user.last_name}`,
            revenue: aggregatedRevenue
        };
    });
    
    const userRevenueData = await Promise.all(userRevenuePromises);
    console.log('User revenue data for radar chart:', userRevenueData);
    
    // Create datasets for each revenue category
    const datasets = [
        {
            label: 'Packages',
            data: userRevenueData.map(u => u.revenue.packages),
            backgroundColor: chartColors.packages.background,
            borderColor: chartColors.packages.border,
            borderWidth: 2,
            pointBackgroundColor: chartColors.packages.point,
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: chartColors.packages.border
        },
        {
            label: 'Emails',
            data: userRevenueData.map(u => u.revenue.emails),
            backgroundColor: chartColors.emails.background,
            borderColor: chartColors.emails.border,
            borderWidth: 2,
            pointBackgroundColor: chartColors.emails.point,
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: chartColors.emails.border
        },
        {
            label: 'Chats',
            data: userRevenueData.map(u => u.revenue.chats),
            backgroundColor: chartColors.chats.background,
            borderColor: chartColors.chats.border,
            borderWidth: 2,
            pointBackgroundColor: chartColors.chats.point,
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: chartColors.chats.border
        },
        {
            label: 'Calls',
            data: userRevenueData.map(u => u.revenue.calls),
            backgroundColor: chartColors.calls.background,
            borderColor: chartColors.calls.border,
            borderWidth: 2,
            pointBackgroundColor: chartColors.calls.point,
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: chartColors.calls.border
        }
        // REVIEW if we add more packages or services then this needs to mannualy created
    ];
    
    console.log('Radar chart datasets:', datasets);
    
    const ctx = radarCanvas.getContext('2d');
    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: userRevenueData.map(u => u.userName),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                r: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(2);
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                title: {
                    display: true,
                    text: 'Revenue Breakdown by User and Type'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.parsed.r.toFixed(2);
                        }
                    }
                }
            }
        }
    });
}

//!SECTION

// ============================================================================
// SECTION: Data Aggregation by Period
// ============================================================================

/**
 * Aggregate daily revenue data into weekly or monthly periods
 * 
 * Takes daily revenue data and aggregates it based on the selected date type:
 * - Daily (1): Returns data as-is
 * - Weekly (7): Groups by week starting on Sunday
 * - Monthly (30): Groups by calendar month
 * 
 * @param {Array<Object>} aggregatedDatabyDay - Daily revenue data
 * @param {Array<Object>} aggregatedDatabyDay[].date - Date string
 * @param {number} aggregatedDatabyDay[].total - Total revenue
 * @param {number} aggregatedDatabyDay[].packages - Package revenue
 * @param {number} aggregatedDatabyDay[].emails - Email revenue
 * @param {number} aggregatedDatabyDay[].chats - Chat revenue
 * @param {number} aggregatedDatabyDay[].calls - Call revenue
 * REVIEW if we add more packages or services then this needs to mannualy created
 * @param {string} dateType - Aggregation type ('1', '7', or '30')
 * @returns {Array<Object>} Aggregated data by period
 * @returns {string} [].label - Period label for display
 * @returns {number} [].total - Aggregated total revenue
 * @returns {number} [].packages - Aggregated package revenue
 * @returns {number} [].emails - Aggregated email revenue
 * @returns {number} [].chats - Aggregated chat revenue
 * @returns {number} [].calls - Aggregated call revenue
 * REVIEW if we add more packages or services then this needs to mannualy created
 * @returns {string[]} [].datesInPeriod - Array of dates included in period
 * 
 * @example
 * const weeklyData = aggregateDataByPeriod(dailyData, '7');
 * // Returns data grouped by week with Sunday as start date
 */
function aggregateDataByPeriod(aggregatedDatabyDay, dateType) {
    const type = parseInt(dateType);
    
    // For daily view, return data as-is with single-date periods
    if (type !== 7 && type !== 30) { 
        return aggregatedDatabyDay.map(d => ({
            label: d.date,
            total: d.total,
            packages: d.packages,
            emails: d.emails,
            chats: d.chats,
            calls: d.calls,
            datesInPeriod: [d.date]
        }));
    }

    const aggregated = {};

    // Aggregate data into periods
    aggregatedDatabyDay.forEach(day => {
        const dateObj = new Date(day.date);
        let key = day.date; 

        if (type === 7) {
            // Weekly: Calculate Sunday (start of week) as period key
            const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 6 = Saturday
            const weekStart = new Date(dateObj);
            weekStart.setDate(dateObj.getDate() - dayOfWeek);
            key = formatDate(weekStart); 
        } else if (type === 30) {
            // Monthly: Use YYYY-MM as period key
            key = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
        }

        // Initialize period if not exists
        if (!aggregated[key]) {
            aggregated[key] = {
                label: key,
                total: 0,
                packages: 0,
                emails: 0,
                chats: 0,
                calls: 0,
                datesInPeriod: [] 
            };
        }

        // Sum revenue for the period
        aggregated[key].total += day.total;
        aggregated[key].packages += day.packages;
        aggregated[key].emails += day.emails;
        aggregated[key].chats += day.chats;
        aggregated[key].calls += day.calls;
        aggregated[key].datesInPeriod.push(day.date);
    });

    console.log('Aggregated periods:', aggregated);
    
    // Format and sort results
    return Object.values(aggregated).map(d => {
        d.datesInPeriod.sort(); // Sort dates chronologically
        
        // Create display-friendly labels
        const displayLabel = (type === 7) 
            ? `Week of ${d.datesInPeriod[0]}` 
            : (type === 30) 
                ? d.label 
                : d.label;
                
        return {
            label: displayLabel,
            total: parseFloat(d.total.toFixed(2)),
            packages: parseFloat(d.packages.toFixed(2)),
            emails: parseFloat(d.emails.toFixed(2)),
            chats: parseFloat(d.chats.toFixed(2)),
            calls: parseFloat(d.calls.toFixed(2)),
            datesInPeriod: d.datesInPeriod
        };
    }).sort((a, b) => {
        // Sort by earliest date in period for chronological order
        const dateA = new Date(a.datesInPeriod[0] || a.label);
        const dateB = new Date(b.datesInPeriod[0] || b.label);
        return dateA.getTime() - dateB.getTime();
    });
}

//!SECTION

// ============================================================================
// SECTION: Main Revenue Chart (Line Graph)
// ============================================================================

/**
 * Render the main aggregate revenue chart for all clients
 * 
 * Creates an interactive line chart showing total revenue over time with:
 * - Trendline for visual analysis
 * - Click-to-drill-down functionality (opens radar chart)
 * - Tooltip showing revenue breakdown
 * - Responsive design
 * 
 * The chart aggregates data by the selected period (daily/weekly/monthly)
 * and displays total revenue across all users.
 * 
 * @async
 * @param {Array<Object>} users - Array of user objects with revenue data
 * @param {string[]} dates - Array of dates in the selected range
 * @param {string} dateType - Aggregation type ('1', '7', or '30')
 * @returns {Promise<void>}
 * 
 * @example
 * await renderMainClientChart(usersArray, datesArray, '7'); // Weekly view
 */
async function renderMainClientChart(users, dates, dateType) {
    const ctx = document.getElementById('main-revenue-chart').getContext('2d');
    
    // Destroy existing chart
    if (mainChartInstance) {
        mainChartInstance.destroy();
    }

    // Fetch revenue data for all users
    const revenuePromises = users.map(user => getRevenueByDateForUser(user.id, dates));
    const userRevenueByDate = await Promise.all(revenuePromises);

    // Aggregate revenue by date across all users
    const aggregatedDatabyDay = dates.map(date => {
        let packages = 0, emails = 0, chats = 0, calls = 0;
        
        userRevenueByDate.forEach(userRevenue => {
            const dayRevenue = userRevenue[date];
            packages += dayRevenue.packages;
            emails += dayRevenue.emails;
            chats += dayRevenue.chats;
            calls += dayRevenue.calls;
        });
        
        return {
            date: date,
            total: parseFloat((packages + emails + chats + calls).toFixed(2)),
            packages: parseFloat(packages.toFixed(2)),
            emails: parseFloat(emails.toFixed(2)),
            chats: parseFloat(chats.toFixed(2)),
            calls: parseFloat(calls.toFixed(2))
        };
    });

    // Aggregate by selected period (daily/weekly/monthly)
    const aggregatedData = aggregateDataByPeriod(aggregatedDatabyDay, dateType);

    const chartLabels = aggregatedData.map(d => d.label);
    const chartTotals = aggregatedData.map(d => d.total);

    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Total Revenue',
                data: chartTotals,
                // borderColor: chartColors.packages.border,
                // backgroundColor: chartColors.packages.background,
                borderWidth: 3,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 8,
                trendlineLinear: {
                    lineStyle: "dotted",
                    width: 2
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: async (event, activeElements) => {
                // Click handler: show radar chart for clicked period
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const clickedPeriod = aggregatedData[index];
                    await showRadarChart(clickedPeriod, users);
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Revenue ($)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(2);
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Total Revenue (All Clients) - Click points to see breakdown' 
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            const periodData = aggregatedData[index]; 
                            if (periodData.datesInPeriod && periodData.datesInPeriod.length > 1) {
                                return `Period: ${periodData.datesInPeriod[0]} to ${periodData.datesInPeriod[periodData.datesInPeriod.length - 1]}`;
                            }
                            return 'Date: ' + context[0].label;
                        },
                        afterLabel: function(context) {
                            const index = context.dataIndex;
                            const data = aggregatedData[index];
                            return [
                                'Packages: $' + data.packages.toFixed(2),
                                'Emails: $' + data.emails.toFixed(2),
                                'Chats: $' + data.chats.toFixed(2),
                                'Calls: $' + data.calls.toFixed(2)
                            ];
                        },
                        label: function(context) {
                            return 'Total: $' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            }
        }
    });
}

//!SECTION

// ============================================================================
// SECTION: User Table Loading
// ============================================================================

/**
 * Load and display the users table with revenue data
 * 
 * This function:
 * 1. Fetches all users with role="user"
 * 2. Calculates package stats and total revenue for each user
 * 3. Sorts users by revenue (descending)
 * 4. Populates the table with interactive rows
 * 5. Renders the main revenue chart
 * 
 * Table rows are clickable to show detailed user breakdown.
 * 
 * @async
 * @returns {Promise<void>}
 * 
 * @throws {Error} If user data cannot be loaded
 * 
 * @example
 * await loadUsers(); // Loads and displays all user data
 */
async function loadUsers() {
    console.log("Loading users...");
    const tbody = document.getElementById('users-tbody');
    
    try {
        // Fetch all non-admin users
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { role: "user" }
        );
        console.log("Users loaded:", users);

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No users found.</td></tr>'; 
            console.warn("No users found.");
            return;
        }

        const dates = getDatesInRange(currentStartDate, currentEndDate);

        // Calculate stats for all users concurrently
        const statsPromises = users.map(async user => {
            const packageStats = await getPackageStatsForUser(user.id);
            const totalRevenue = await getTotalRevenueForUser(user.id, dates);
            return { ...packageStats, totalRevenue };
        });
        const userStats = await Promise.all(statsPromises);
        console.log("User stats loaded:", userStats);

        // Combine user data with calculated stats
        const usersWithStats = users.map((user, index) => ({
            ...user,
            ...userStats[index]
        }));

        // Sort by revenue (highest first)
        usersWithStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

        // Populate table
        tbody.innerHTML = '';
        usersWithStats.forEach((user, index) => {
            console.log("Rendering user:", user);
            
            const tr = document.createElement('tr');

            const revenueText = `$${user.totalRevenue.toFixed(2)}`; 
            const packageText = user.packageNames;

            tr.innerHTML = `
                <td>${user.id}</td>
                <td>${user.first_name}</td>
                <td>${user.last_name}</td>
                <td>${user.email}</td>
                <td>${revenueText}</td>
                <td>${packageText}</td>
            `;
            
            // Add click handler for detailed view
            tr.addEventListener('click', () => showUserDetail(user));
            tbody.appendChild(tr);
        });
        
        // Render main aggregate chart
        await renderMainClientChart(usersWithStats, dates, currentDateType);

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="error">Error loading users: ${error.message}</td></tr>`;
        console.error("Error loading users:", error);
    }
}

//!SECTION

// ============================================================================
// SECTION: User Detail View
// ============================================================================

/**
 * Display detailed revenue breakdown for a specific user
 * 
 * Shows:
 * - Summary statistics (total revenue by category)
 * - Stacked bar chart of daily revenue (emails, chats, calls)
 * - List of active manual packages with pricing
 * 
 * Note: Packages are shown separately as they're constant daily charges,
 * while other categories vary by usage.
 * 
 * @async
 * @param {Object} user - User object with full details
 * @param {number} user.id - User ID
 * @param {string} user.first_name - User first name
 * @param {string} user.last_name - User last name
 * @param {Array} user.packages - Array of package objects
 * @returns {Promise<void>}
 * 
 * @example
 * await showUserDetail({ id: 123, first_name: 'John', last_name: 'Doe', packages: [...] });
 */
async function showUserDetail(user) {
    console.log("Showing details for user:", user);
    currentUser = user;
    
    const detailView = document.getElementById('user-detail-view');
    detailView.style.display = 'block';
    
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    // Reset stat values
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    // Smooth scroll to detail view
    detailView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    try {
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        
        // Get revenue breakdown by date
        const revenueByDate = await getRevenueByDateForUser(user.id, dates);
        
        // Prepare chart datasets (exclude packages as they're constant)
        const labels = dates;
        const datasets = [
            {
                label: 'Emails',
                data: labels.map(date => parseFloat(revenueByDate[date].emails.toFixed(2))),
                backgroundColor: chartColors.emails.border
            },
            {
                label: 'Chats',
                data: labels.map(date => parseFloat(revenueByDate[date].chats.toFixed(2))),
                backgroundColor: chartColors.chats.border
            },
            {
                label: 'Calls',
                data: labels.map(date => parseFloat(revenueByDate[date].calls.toFixed(2))),
                backgroundColor: chartColors.packages.border
            }
        ];

        // Calculate totals for summary statistics
        const totals = {
            packages: labels.reduce((sum, date) => sum + revenueByDate[date].packages, 0),
            emails: datasets[0].data.reduce((sum, val) => sum + val, 0),
            chats: datasets[1].data.reduce((sum, val) => sum + val, 0),
            calls: datasets[2].data.reduce((sum, val) => sum + val, 0)
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls;

        // Update stat cards
        document.getElementById('stat-packages').textContent = `$${totals.packages.toFixed(2)}`;
        document.getElementById('stat-emails').textContent = `$${totals.emails.toFixed(2)}`;
        document.getElementById('stat-chats').textContent = `$${totals.chats.toFixed(2)}`;
        document.getElementById('stat-calls').textContent = `$${totals.calls.toFixed(2)}`;
        document.getElementById('stat-total').textContent = `$${totals.total.toFixed(2)}`;

        // Render stacked bar chart
        const ctx = document.getElementById('revenue-chart').getContext('2d');
        
        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return 'Date: ' + context[0].label;
                            },
                            afterLabel: function(context) {
                                const date = context.label;
                                const dayData = revenueByDate[date];
                                return [
                                    'Emails: $' + dayData.emails.toFixed(2),
                                    'Chats: $' + dayData.chats.toFixed(2),
                                    'Calls: $' + dayData.calls.toFixed(2)
                                ];
                            },
                            footer: function(context) {
                                const date = context[0].label;
                                const dayData = revenueByDate[date];
                                const total = dayData.emails + dayData.chats + dayData.calls;
                                return 'Total: $' + total.toFixed(2);
                            },
                            label: function() {
                                return '';
                            }
                        }
                    },
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });

        // Display packages separately (as they're constant recurring charges)
        if (user.packages && user.packages.length > 0) {
            const packagesCard = document.getElementById('packages-card');
            const packagesGrid = document.getElementById('packages-grid');
            
            // Aggregate packages by name (handle duplicates)
            const packageAggregation = {};
            user.packages.forEach(pkg => {
                const name = pkg.name || 'Unnamed Package';
                if (!packageAggregation[name]) {
                    packageAggregation[name] = {
                        name: name,
                        cost: 0,
                        count: 0,
                        frequency: pkg.frequency || 'Weekly'
                    }; 
                }
                packageAggregation[name].cost += parseFloat(pkg.cost) || 0;
                packageAggregation[name].count += 1;
            });
            
            // Render package cards
            packagesGrid.innerHTML = '';
            Object.values(packageAggregation).forEach(pkg => {
                const pkgDiv = document.createElement('div');
                pkgDiv.className = 'package-item';
                
                const countText = pkg.count > 1 ? ` (x${pkg.count})` : '';
                
                pkgDiv.innerHTML = `
                    <div class="package-header">
                        <h4>${pkg.name}${countText}</h4>
                        <span class="package-badge">${pkg.frequency}</span>
                    </div>
                    <p class="package-cost">$${pkg.cost.toFixed(2)}</p>
                `;
                packagesGrid.appendChild(pkgDiv);
            });
            
            packagesCard.style.display = 'block';
        } else {
            document.getElementById('packages-card').style.display = 'none';
        }

    } catch (error) {
        console.error("Error loading chart:", error);
        alert('Error loading revenue data: ' + error.message);
    }
}

//!SECTION

// ============================================================================
// SECTION: Tab Management
// FIXME chang to sidebar navigation
// ============================================================================

/**
 * Switch between Clients and Commissions tabs
 * 
 * Handles tab navigation by:
 * - Updating active tab styling
 * - Showing/hiding appropriate content sections
 * 
 * @param {string} tabName - Tab identifier ('clients' or 'commissions')
 * @returns {void}
 * 
 * @example
 * switchTab('clients'); // Shows clients tab
 * switchTab('commissions'); // Shows commissions tab
 */
function switchTab(tabName) {
    const clientsTab = document.getElementById('clients-tab');
    const commissionsTab = document.getElementById('commissions-tab');
    const clientsContent = document.getElementById('clients-content');
    const commissionsContent = document.getElementById('commissions-content');

    if (tabName === 'clients') {
        clientsTab.classList.add('active');
        commissionsTab.classList.remove('active');
        clientsContent.style.display = 'block';
        commissionsContent.style.display = 'none';
    } else if (tabName === 'commissions') {
        commissionsTab.classList.add('active');
        clientsTab.classList.remove('active');
        commissionsContent.style.display = 'block';
        clientsContent.style.display = 'none';
    }
}

//!SECTION

// ============================================================================
// SECTION: Application Initialization
// ============================================================================

/**
 * Initialize the application when DOM is ready
 * 
 * Sets up:
 * - Default date range (last Sunday to today)
 * - Event listeners for date inputs and controls
 * - Tab navigation
 * - Initial data load
 * 
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    const startDateInput = document.getElementById("start-date");
    const endDateInput = document.getElementById("end-date");
    const currentDateTypeInput = document.getElementById("date-type");
    const loadButton = document.getElementById("load-users");

    // Set default date range (last Sunday to today)
    const today = new Date();
    const lastSunday = getLastSunday();
    
    currentEndDate = formatDate(today);
    currentStartDate = formatDate(lastSunday);
    currentDateType = '1'; // Daily view by default
    
    startDateInput.value = currentStartDate;
    endDateInput.value = currentEndDate;
    currentDateTypeInput.value = currentDateType;
    
    // Date change event handlers
    startDateInput.addEventListener('change', (e) => {
        currentStartDate = e.target.value;
        sessionCache.clear(); // Clear cache when dates change
    });
    
    endDateInput.addEventListener('change', (e) => {
        currentEndDate = e.target.value;
        sessionCache.clear();
    });

    currentDateTypeInput.addEventListener('change', (e) => {
        currentDateType = e.target.value;
        sessionCache.clear();
    });
    
    // Load button handler
    loadButton.addEventListener('click', () => {
        sessionCache.clear(); // Clear cache on manual reload
        loadUsers();
        // Hide detail views on reload
        document.getElementById('user-detail-view').style.display = 'none'; 
        document.getElementById('radar-chart-container').style.display = 'none';
    });

    // Tab navigation handlers
    const clientsTab = document.getElementById('clients-tab');
    const commissionsTab = document.getElementById('commissions-tab');
    
    if (clientsTab) {
        clientsTab.addEventListener('click', () => switchTab('clients'));
    }
    
    if (commissionsTab) {
        commissionsTab.addEventListener('click', () => switchTab('commissions'));
    }

    // Initialize application
    switchTab('clients');
    loadUsers();
});

//!SECTION

/**
 * ============================================================================
 * END OF APPLICATION
 * ============================================================================
 */