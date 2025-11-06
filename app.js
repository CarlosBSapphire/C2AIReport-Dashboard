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
 * @version 3.1.0
 * @requires Chart.js v4.4.9
 * @requires chartjs-plugin-trendline
 * 
 * ARCHITECTURE OVERVIEW:
 * ----------------------
 * 1. Data Fetching: Retrieves data from API endpoint with session caching
 * 2. Revenue Calculation: Aggregates revenue across multiple service types
 * 3. Visualization: Displays data using Chart.js 
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
 * Chart instance for bubble breakdown visualization
 * @type {Chart|null}
 */
let bubbleChartInstance = null;

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
 * @values '1' = Daily, '7' = Weekly, '30' = Monthly, '365' = Yearly
 */
let currentDateType = null;

/**
 * Store all users data for stat card drill-down
 * @type {Array<Object>}
 */
let allUsersData = [];

/**
 * Store all dates in current range for stat card drill-down
 * @type {Array<string>}
 */
let allDatesInRange = [];

/**
 * Track which chart is currently displayed
 * @type {string|null}
 * @values 'main' = Main revenue chart, 'bubble' = Bubble chart, 'user' = User detail chart
 */
let currentChartView = null;

/**
 * Pagination state for service detail modal
 * @type {Object}
 */
let paginationState = {
    currentPage: 1,
    recordsPerPage: 20,
    totalRecords: 0,
    allRecords: [],
    serviceType: null,
    userId: null,
    dates: null
};

/**
 * Start date for client tab (independent from revenue tab)
 * @type {string|null}
 */
let clientStartDate = null;

/**
 * End date for client tab (independent from revenue tab)
 * @type {string|null}
 */
let clientEndDate = null;

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

/**
 * Get the day of week name for a given date
 * 
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Day name (e.g., 'Sunday', 'Monday')
 */
const getDayOfWeek = (dateString) => {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const date = new Date(dateString);
    return daysOfWeek[date.getDay()];
}

/**
 * Get the week number and year for a given date
 * 
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Week identifier (e.g., 'Week 1', 'Week 2')
 */
const getWeekOfMonth = (dateString) => {
    const date = new Date(dateString);
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const dayOfMonth = date.getDate();
    const dayOfWeek = firstDayOfMonth.getDay();
    const weekNumber = Math.ceil((dayOfMonth + dayOfWeek) / 7);
    return `Week ${weekNumber}`;
}

/**
 * Get the month name for a given date
 * 
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Month name (e.g., 'January', 'February')
 */
const getMonthName = (dateString) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    const date = new Date(dateString);
    return months[date.getMonth()];
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
 * REVIEW: When adding new service types, update the dateColumnMap in this function
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
        // REVIEW: If adding new service types, add their table names and date column mappings here
        const dateColumnMap = {
            'Daily_Email_Cost_Record': 'created_date',
            'Daily_Chat_Record_Cost_Record': 'created_date',
            'Daily_Calls_Cost_Record': 'created_date',
            'AI_Email_Records': 'updated_at',
            'Call_Data': 'created_at',
            'AI_Chat_Data': 'created_date'
        };
        
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
        const userIdInfo = filters.user_id ? ` for user ID: ${filters.user_id}` : '';
        console.warn(`Empty response body received from table: ${tableName}${userIdInfo}`);
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
 * REVIEW: If adding new package types or pricing models, update this function
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
    const packages = await fetchData("manual_charges", ["user_id", "cost", "name", "frequency", "created_time"], { user_id: userId });
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
 * - Manual packages (prorated daily based on frequency and accounting for created_time)
 * - Email overages (beyond threshold)
 * - Chat conversations
 * - Call minutes
 * 
 * REVIEW: If adding new service types, add new properties to the return object structure
 * and add new fetchData calls for the new service tables
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
 * 
 * @example
 * const revenue = await getRevenueByDateForUser(123, ['2024-01-01', '2024-01-02']);
 * console.log(revenue['2024-01-01'].packages); // 5.71 (daily proration)
 */
async function getRevenueByDateForUser(userId, dates) {
    // Fetch all revenue data sources concurrently
    // REVIEW: If adding new service types, add new fetchData calls here and include in Promise.all
    const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts] = await Promise.all([
        fetchData("manual_charges", ["user_id", "frequency", "cost", "name", "created_time"], { user_id: userId }),
        fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: userId }),
        fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: userId }),
        fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: userId })
    ]);

    // Initialize revenue structure for all dates
    // REVIEW: If adding new service types, add new properties to this object
    const revenueByDate = {};
    dates.forEach(date => {
        revenueByDate[date] = {
            packages: 0,
            emails: 0,
            chats: 0,
            calls: 0
        };
    });

    // Calculate daily package cost (prorated from weekly/monthly) accounting for created_time
    dates.forEach(date => {
        let dailyPackageCost = 0;
        
        packages.forEach(pkg => {
            const packageCost = parseFloat(pkg.cost) || 0;
            const createdDate = pkg.created_time ? formatDate(new Date(pkg.created_time)) : null;
            
            // Only count package if it was created on or before this date
            if (!createdDate || createdDate <= date) {
                let dailyCost = 0;
                
                if (pkg.frequency === 'Weekly') {
                    // Weekly packages: divide by 7 days
                    dailyCost = packageCost / 7;
                } else if (pkg.frequency === 'Monthly') {
                    // Monthly packages: divide by 30.5 days (average month length)
                    dailyCost = packageCost / 30.5;
                }
                
                dailyPackageCost += dailyCost;
            }
        });
        
        revenueByDate[date].packages = dailyPackageCost;
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
    
    // REVIEW: If adding new service types, add processing logic here similar to emails/chats/calls above
    
    return revenueByDate;
}

/**
 * Calculate total revenue for a user across a date range
 * 
 * Sums all revenue categories for all dates in the specified range.
 * 
 * REVIEW: If adding new service types, update the revenue summation logic
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
        // REVIEW: If adding new service types, add them to this summation
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
 * REVIEW: If adding new service types, add corresponding color definitions here
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
};

/**
 * Color palette for sub-categories (days of week, weeks of month, months of year)
 * 
 * @constant {Array<string>}
 */
const subCategoryColors = [
    '#00356f', // Navy
    '#0467d2', // Blue
    '#008387', // Teal
    '#46c2c6', // Light teal
    '#f59e0b', // Amber
    '#2563eb', // Royal blue
    '#3b82f6'  // Sky blue
];

//!SECTION

// ============================================================================
// SECTION: Chart Management
// ============================================================================

/**
 * Hide all charts except the specified one
 * 
 * @param {string} chartToShow - Which chart to display ('main', 'bubble', 'user', or 'none')
 */
function hideOtherCharts(chartToShow) {
    const mainChart = document.getElementById('main-client-chart');
    const bubbleChart = document.getElementById('bubble-chart-container');
    const userDetail = document.getElementById('user-detail-view');
    
    // Hide all by default
    mainChart.style.display = 'none';
    bubbleChart.style.display = 'none';
    userDetail.style.display = 'none';
    
    // Show the requested chart
    switch(chartToShow) {
        case 'main':
            mainChart.style.display = 'block';
            currentChartView = 'main';
            break;
        case 'bubble':
            bubbleChart.style.display = 'block';
            currentChartView = 'bubble';
            break;
        case 'user':
            userDetail.style.display = 'block';
            currentChartView = 'user';
            break;
        case 'none':
            currentChartView = null;
            break;
    }
    
    // Update back button visibility
    const backButton = document.getElementById('back-button');
    if (chartToShow === 'bubble' || chartToShow === 'user') {
        backButton.style.display = 'block';
    } else {
        backButton.style.display = 'none';
    }
}

/**
 * Handle back button click - navigate to previous view
 */
function deployBackbutton() {
    const backButton = document.getElementById('back-button');
    
    backButton.onclick = () => {
        if (currentChartView === 'bubble') {
            // From bubble chart, go back to main chart
            hideOtherCharts('main');
        } else if (currentChartView === 'user') {
            // From user detail, go back to client table
            hideOtherCharts('none');
            document.getElementById('users-table').scrollIntoView({ behavior: 'smooth' });
        }
    };
}

//!SECTION

// ============================================================================
// SECTION: Bubble Chart for Revenue Breakdown
// ============================================================================

/**
 * Display bubble chart showing revenue breakdown by user, date, and type
 * 
 * Creates a bubble chart where:
 * - X-axis represents dates
 * - Y-axis represents users
 * - Bubble size represents revenue amount
 * - Bubble color represents revenue type (packages, emails, chats, calls)
 * 
 * REVIEW: If adding new service types, add new datasets to this function
 * 
 * @async
 * @param {Object} period - Period data object
 * @param {string[]} period.datesInPeriod - Array of dates in the period
 * @param {string} period.label - Display label for the period
 * @param {Array<Object>} users - Array of user objects
 * @returns {Promise<void>}
 * 
 * @example
 * await showBubbleChart(
 *   { datesInPeriod: ['2024-01-01'], label: '2024-01-01' },
 *   [{ id: 1, first_name: 'John', last_name: 'Doe' }]
 * );
 */
async function showBubbleChart(period, users) {
    hideOtherCharts('bubble');
    
    const bubbleCanvas = document.getElementById('bubble-chart');
    const datesInPeriod = period.datesInPeriod;
    
    // Format date display
    const dateDisplay = datesInPeriod.length > 1 
        ? `${datesInPeriod[0]} to ${datesInPeriod[datesInPeriod.length - 1]}` 
        : datesInPeriod[0];
    
    document.getElementById('bubble-date').textContent = dateDisplay;
    
    // Destroy existing chart instance
    if (bubbleChartInstance) {
        bubbleChartInstance.destroy();
    }
    
    // Get all dates in current range for data aggregation
    const allDatesInCurrentRange = getDatesInRange(currentStartDate, currentEndDate);

    // Calculate revenue for each user on each date in the period
    const bubbleData = {
        packages: [],
        emails: [],
        chats: [],
        calls: []
        // REVIEW: If adding new service types, add new arrays here
    };
    
    for (let userIdx = 0; userIdx < users.length; userIdx++) {
        const user = users[userIdx];
        const revenueByDate = await getRevenueByDateForUser(user.id, allDatesInCurrentRange);
        
        datesInPeriod.forEach((date, dateIdx) => {
            const dayRevenue = revenueByDate[date];
            if (dayRevenue) {
                // REVIEW: If adding new service types, create bubble data points here
                if (dayRevenue.packages > 0) {
                    bubbleData.packages.push({
                        x: dateIdx,
                        y: userIdx,
                        r: Math.sqrt(dayRevenue.packages) * 5,
                        revenue: dayRevenue.packages,
                        date: date,
                        user: `${user.first_name} ${user.last_name}`
                    });
                }
                if (dayRevenue.emails > 0) {
                    bubbleData.emails.push({
                        x: dateIdx,
                        y: userIdx,
                        r: Math.sqrt(dayRevenue.emails) * 5,
                        revenue: dayRevenue.emails,
                        date: date,
                        user: `${user.first_name} ${user.last_name}`
                    });
                }
                if (dayRevenue.chats > 0) {
                    bubbleData.chats.push({
                        x: dateIdx,
                        y: userIdx,
                        r: Math.sqrt(dayRevenue.chats) * 5,
                        revenue: dayRevenue.chats,
                        date: date,
                        user: `${user.first_name} ${user.last_name}`
                    });
                }
                if (dayRevenue.calls > 0) {
                    bubbleData.calls.push({
                        x: dateIdx,
                        y: userIdx,
                        r: Math.sqrt(dayRevenue.calls) * 5,
                        revenue: dayRevenue.calls,
                        date: date,
                        user: `${user.first_name} ${user.last_name}`
                    });
                }
            }
        });
    }
    
    // Create datasets for each revenue category
    // REVIEW: If adding new service types, add new dataset objects here
    const datasets = [
        {
            label: 'Packages',
            data: bubbleData.packages,
            backgroundColor: hexToRgba(getCSSVariable('--primary'), 0.6),
            borderColor: getCSSVariable('--primary'),
            borderWidth: 2
        },
        {
            label: 'Emails',
            data: bubbleData.emails,
            backgroundColor: hexToRgba(getCSSVariable('--pending'), 0.6),
            borderColor: getCSSVariable('--pending'),
            borderWidth: 2
        },
        {
            label: 'Chats',
            data: bubbleData.chats,
            backgroundColor: hexToRgba(getCSSVariable('--secondary'), 0.6),
            borderColor: getCSSVariable('--secondary'),
            borderWidth: 2
        },
        {
            label: 'Calls',
            data: bubbleData.calls,
            backgroundColor: hexToRgba(getCSSVariable('--info'), 0.6),
            borderColor: getCSSVariable('--info'),
            borderWidth: 2
        }
    ];
    
    const ctx = bubbleCanvas.getContext('2d');
    bubbleChartInstance = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        callback: function(value) {
                            return datesInPeriod[Math.floor(value)] || '';
                        },
                        stepSize: 1
                    },
                    min: -0.5,
                    max: datesInPeriod.length - 0.5
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'User'
                    },
                    ticks: {
                        callback: function(value) {
                            const user = users[Math.floor(value)];
                            return user ? `${user.first_name} ${user.last_name}` : '';
                        },
                        stepSize: 1
                    },
                    min: -0.5,
                    max: users.length - 0.5
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                title: {
                    display: true,
                    text: 'Revenue Breakdown by User, Date, and Type'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = context.raw;
                            return [
                                `User: ${point.user}`,
                                `Date: ${point.date}`,
                                `Type: ${context.dataset.label}`,
                                `Revenue: $${point.revenue.toFixed(2)}`
                            ];
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
 * Aggregate daily revenue data into weekly, monthly, or yearly periods
 * 
 * Takes daily revenue data and aggregates it based on the selected date type:
 * - Daily (1): Returns data as-is
 * - Weekly (7): Groups by week starting on Sunday
 * - Monthly (30): Groups by calendar month
 * - Yearly (365): Groups by calendar year
 * 
 * REVIEW: If adding new service types, ensure they are included in the aggregation
 * 
 * @param {Array<Object>} aggregatedDatabyDay - Daily revenue data
 * @param {Array<Object>} aggregatedDatabyDay[].date - Date string
 * @param {number} aggregatedDatabyDay[].total - Total revenue
 * @param {number} aggregatedDatabyDay[].packages - Package revenue
 * @param {number} aggregatedDatabyDay[].emails - Email revenue
 * @param {number} aggregatedDatabyDay[].chats - Chat revenue
 * @param {number} aggregatedDatabyDay[].calls - Call revenue
 * @param {string} dateType - Aggregation type ('1', '7', '30', or '365')
 * @returns {Array<Object>} Aggregated data by period
 * @returns {string} [].label - Period label for display
 * @returns {number} [].total - Aggregated total revenue
 * @returns {number} [].packages - Aggregated package revenue
 * @returns {number} [].emails - Aggregated email revenue
 * @returns {number} [].chats - Aggregated chat revenue
 * @returns {number} [].calls - Aggregated call revenue
 * @returns {string[]} [].datesInPeriod - Array of dates included in period
 * @returns {Object} [].subCategories - Sub-category breakdown (days/weeks/months)
 * 
 * @example
 * const weeklyData = aggregateDataByPeriod(dailyData, '7');
 * // Returns data grouped by week with Sunday as start date
 */
function aggregateDataByPeriod(aggregatedDatabyDay, dateType) {
    const type = parseInt(dateType);
    
    // For daily view, return data as-is with single-date periods
    if (type === 1) { 
        return aggregatedDatabyDay.map(d => ({
            label: d.date,
            total: d.total,
            packages: d.packages,
            emails: d.emails,
            chats: d.chats,
            calls: d.calls,
            datesInPeriod: [d.date],
            subCategories: {}
        }));
    }

    const aggregated = {};

    // Aggregate data into periods
    aggregatedDatabyDay.forEach(day => {
        const dateObj = new Date(day.date);
        let key = day.date;
        let subCategory = '';

        if (type === 7) {
            // Weekly: Calculate Sunday (start of week) as period key
            const dayOfWeek = dateObj.getDay();
            const weekStart = new Date(dateObj);
            weekStart.setDate(dateObj.getDate() - dayOfWeek);
            key = formatDate(weekStart);
            subCategory = getDayOfWeek(day.date);
        } else if (type === 30) {
            // Monthly: Use YYYY-MM as period key
            key = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
            subCategory = getWeekOfMonth(day.date);
        } else if (type === 365) {
            // Yearly: Use YYYY as period key
            key = String(dateObj.getFullYear());
            subCategory = getMonthName(day.date);
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
                datesInPeriod: [],
                subCategories: {}
                // REVIEW: If adding new service types, initialize them here
            };
        }

        // Initialize sub-category if not exists
        if (subCategory && !aggregated[key].subCategories[subCategory]) {
            aggregated[key].subCategories[subCategory] = {
                packages: 0,
                emails: 0,
                chats: 0,
                calls: 0
                // REVIEW: If adding new service types, initialize them here
            };
        }

        // Sum revenue for the period
        aggregated[key].total += day.total;
        aggregated[key].packages += day.packages;
        aggregated[key].emails += day.emails;
        aggregated[key].chats += day.chats;
        aggregated[key].calls += day.calls;
        aggregated[key].datesInPeriod.push(day.date);
        
        // Sum revenue for sub-category
        if (subCategory) {
            aggregated[key].subCategories[subCategory].packages += day.packages;
            aggregated[key].subCategories[subCategory].emails += day.emails;
            aggregated[key].subCategories[subCategory].chats += day.chats;
            aggregated[key].subCategories[subCategory].calls += day.calls;
        }
        
        // REVIEW: If adding new service types, add them to the summation above
    });

    console.log('Aggregated periods:', aggregated);
    
    // Format and sort results
    return Object.values(aggregated).map(d => {
        d.datesInPeriod.sort(); // Sort dates chronologically
        
        // Create display-friendly labels
        let displayLabel = d.label;
        if (type === 7) {
            displayLabel = `Week of ${d.datesInPeriod[0]}`;
        } else if (type === 30) {
            const date = new Date(d.label + '-01');
            displayLabel = `${getMonthName(formatDate(date))} ${date.getFullYear()}`;
        } else if (type === 365) {
            displayLabel = d.label;
        }
                
        return {
            label: displayLabel,
            total: parseFloat(d.total.toFixed(2)),
            packages: parseFloat(d.packages.toFixed(2)),
            emails: parseFloat(d.emails.toFixed(2)),
            chats: parseFloat(d.chats.toFixed(2)),
            calls: parseFloat(d.calls.toFixed(2)),
            datesInPeriod: d.datesInPeriod,
            subCategories: d.subCategories
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
// SECTION: Main Revenue Chart (Stacked Bar Chart)
// ============================================================================

/**
 * Render the main aggregate revenue chart for all clients
 * 
 * Creates a stacked bar chart showing revenue over time with:
 * - Sub-category stacking (days of week, weeks of month, months of year)
 * - Trendline for visual analysis
 * - Click-to-drill-down functionality (opens bubble chart)
 * - Tooltip showing revenue breakdown
 * - Responsive design
 * 
 * The chart aggregates data by the selected period and displays revenue
 * broken down by sub-categories based on the period type.
 * 
 * REVIEW: If adding new service types, add them to the datasets array
 * 
 * @async
 * @param {Array<Object>} users - Array of user objects with revenue data
 * @param {string[]} dates - Array of dates in the selected range
 * @param {string} dateType - Aggregation type ('1', '7', '30', or '365')
 * @returns {Promise<void>}
 * 
 * @example
 * await renderMainClientChart(usersArray, datesArray, '7'); // Weekly view
 */
async function renderMainClientChart(users, dates, dateType) {
    console.log('ranedering main chart')
    const ctx = document.getElementById('main-revenue-chart').getContext('2d');
    
    // Destroy existing chart
    if (mainChartInstance) {
        mainChartInstance.destroy();
    }

    hideOtherCharts('main');

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
            // REVIEW: If adding new service types, add them here
        };
    });

    // Aggregate by selected period (daily/weekly/monthly/yearly)
    const aggregatedData = aggregateDataByPeriod(aggregatedDatabyDay, dateType);

    const chartLabels = aggregatedData.map(d => d.label);
    
    // Create datasets based on period type
    const datasets = [];
    const type = parseInt(dateType);
    
    if (type === 1) {
        // Daily view - show services as separate datasets
        // REVIEW: If adding new service types, add new dataset objects here
        datasets.push({
            label: 'Packages',
            data: aggregatedData.map(d => d.packages),
            backgroundColor: chartColors.packages.border,
            stack: 'revenue',
            hidden: true
        });
        datasets.push({
            label: 'Emails',
            data: aggregatedData.map(d => d.emails),
            backgroundColor: chartColors.emails.border,
            stack: 'revenue'
        });
        datasets.push({
            label: 'Chats',
            data: aggregatedData.map(d => d.chats),
            backgroundColor: chartColors.chats.border,
            stack: 'revenue'
        });
        datasets.push({
            label: 'Calls',
            data: aggregatedData.map(d => d.calls),
            backgroundColor: chartColors.calls.border,
            stack: 'revenue'
        });
    } else {
        // Weekly/Monthly/Yearly view - show sub-categories
        // Get all unique sub-category names
        const subCategoryNames = new Set();
        aggregatedData.forEach(period => {
            Object.keys(period.subCategories).forEach(cat => subCategoryNames.add(cat));
        });
        
        // Sort sub-categories
        const sortedSubCategories = Array.from(subCategoryNames).sort((a, b) => {
            if (type === 7) {
                // Sort days of week
                const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                return days.indexOf(a) - days.indexOf(b);
            } else if (type === 30) {
                // Sort weeks
                const weekNum = (w) => parseInt(w.replace('Week ', ''));
                return weekNum(a) - weekNum(b);
            } else if (type === 365) {
                // Sort months
                const months = ['January', 'February', 'March', 'April', 'May', 'June',
                              'July', 'August', 'September', 'October', 'November', 'December'];
                return months.indexOf(a) - months.indexOf(b);
            }
            return 0;
        });
        
        // Create a dataset for each sub-category
        sortedSubCategories.forEach((subCat, idx) => {
            datasets.push({
                label: subCat,
                data: aggregatedData.map(d => {
                    const subCatData = d.subCategories[subCat];
                    if (!subCatData) return 0;
                    // REVIEW: If adding new service types, add them to this summation
                    return parseFloat((subCatData.packages + subCatData.emails + 
                                     subCatData.chats + subCatData.calls).toFixed(2));
                }),
                backgroundColor: subCategoryColors[idx % subCategoryColors.length],
                stack: 'revenue'
            });
        });
    }
    
    // Add transparent dataset for trendline
    datasets.push({
        label: 'Trend',
        data: aggregatedData.map(d => d.total),
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderColor: getCSSVariable('--text'),
        borderWidth: 2,
        type: 'line',
        fill: false,
        pointRadius: 0,
        trendlineLinear: {
            colorMin: getCSSVariable('--text'),
            colorMax: getCSSVariable('--text'),
            lineStyle: "dotted",
            width: 2
        }
    });

    mainChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: async (event, activeElements) => {
                // Click handler: show bubble chart for clicked period
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const clickedPeriod = aggregatedData[index];
                    await showBubbleChart(clickedPeriod, users);
                }
            },
            scales: {
                x: {
                    stacked: true,
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
                    stacked: true,
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
                title: {
                    display: true,
                    text: 'Total Revenue (All Clients) - Click bars to see breakdown'
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
                        footer: function(context) {
                            const index = context[0].dataIndex;
                            const data = aggregatedData[index];
                            return 'Total: $' + data.total.toFixed(2);
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'bottom'
                }
            }
        }
    });
}

//!SECTION

// ============================================================================
// SECTION: Service Detail Modal with Pagination
// ============================================================================

/**
 * Render pagination controls for service detail modal
 */
function renderPaginationControls() {
    const totalPages = Math.ceil(paginationState.totalRecords / paginationState.recordsPerPage);
    
    const paginationHTML = `
        <div class="pagination-controls">
            <button id="prev-page" ${paginationState.currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${paginationState.currentPage} of ${totalPages}</span>
            <button id="next-page" ${paginationState.currentPage === totalPages ? 'disabled' : ''}>Next</button>
            <span class="records-info">Showing ${Math.min((paginationState.currentPage - 1) * paginationState.recordsPerPage + 1, paginationState.totalRecords)} - ${Math.min(paginationState.currentPage * paginationState.recordsPerPage, paginationState.totalRecords)} of ${paginationState.totalRecords} records</span>
        </div>
    `;
    
    return paginationHTML;
}

/**
 * Get records for current page
 */
function getCurrentPageRecords() {
    const startIdx = (paginationState.currentPage - 1) * paginationState.recordsPerPage;
    const endIdx = startIdx + paginationState.recordsPerPage;
    return paginationState.allRecords.slice(startIdx, endIdx);
}

/**
 * Update modal content with paginated records
 */
function updateModalContent() {
    const modalBody = document.getElementById('service-modal-body');
    const records = getCurrentPageRecords();
    let tableHTML = '';
    
    // REVIEW: If adding new service types, add new case here
    switch(paginationState.serviceType) {
        case 'packages':
            tableHTML = `
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>Package Name</th>
                            <th>Frequency</th>
                            <th>Cost</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td>${r.name || 'Unnamed'}</td>
                                <td>${r.frequency}</td>
                                <td>$${parseFloat(r.cost).toFixed(2)}</td>
                                <td>${r.created_time ? new Date(r.created_time).toLocaleString() : 'N/A'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${renderPaginationControls()}
            `;
            break;
            
        case 'emails':
            tableHTML = `
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>From</th>
                            <th>Subject</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td>${new Date(r.updated_at).toLocaleString()}</td>
                                <td>${r.from_email || 'N/A'}</td>
                                <td>${r.subject || 'No Subject'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${renderPaginationControls()}
            `;
            break;
            
        case 'chats':
            tableHTML = `
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Conversation ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td>${new Date(r.created_date).toLocaleString()}</td>
                                <td>${r.conversation_id || 'N/A'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${renderPaginationControls()}
            `;
            break;
            
        case 'calls':
            tableHTML = `
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Duration (minutes)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td>${new Date(r.created_at).toLocaleString()}</td>
                                <td>${parseFloat(r.duration || 0).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${renderPaginationControls()}
            `;
            break;
            
        default:
            tableHTML = '<p>Service type not recognized.</p>';
    }
    
    modalBody.innerHTML = tableHTML;
    
    // Attach pagination event listeners
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (paginationState.currentPage > 1) {
                paginationState.currentPage--;
                updateModalContent();
            }
        };
    }
    
    if (nextBtn) {
        nextBtn.onclick = () => {
            const totalPages = Math.ceil(paginationState.totalRecords / paginationState.recordsPerPage);
            if (paginationState.currentPage < totalPages) {
                paginationState.currentPage++;
                updateModalContent();
            }
        };
    }
}

/**
 * Show detailed service records in a modal when stat card is clicked
 * 
 * Fetches and displays all records for a specific service type within
 * the selected date range for the current user.
 * 
 * REVIEW: If adding new service types, add new cases to the switch statement
 * and create corresponding fetch logic
 * 
 * @async
 * @param {string} serviceType - Type of service ('packages', 'emails', 'chats', 'calls')
 * @param {number} userId - User ID to query
 * @param {string[]} dates - Array of dates in range
 * @returns {Promise<void>}
 */
async function showServiceDetail(serviceType, userId, dates) {
    const modal = document.getElementById('service-detail-modal');
    const modalTitle = document.getElementById('service-modal-title');
    const modalBody = document.getElementById('service-modal-body');
    
    modalTitle.textContent = `${serviceType.charAt(0).toUpperCase() + serviceType.slice(1)} Details`;
    modalBody.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading data...</p></div>';
    modal.style.display = 'block';
    
    // Store pagination state
    paginationState.serviceType = serviceType;
    paginationState.userId = userId;
    paginationState.dates = dates;
    paginationState.currentPage = 1;
    
    try {
        let records = [];
        
        // REVIEW: If adding new service types, add new case here
        switch(serviceType) {
            case 'packages':
                records = await fetchData("manual_charges", 
                    ["user_id", "cost", "name", "frequency", "created_time"], 
                    { user_id: userId });
                break;
                
            case 'emails':
                records = await fetchData("AI_Email_Records", 
                    ["user_id", "updated_at", "subject", "from_email"], 
                    { user_id: userId });
                break;
                
            case 'chats':
                records = await fetchData("AI_Chat_Data", 
                    ["user_id", "created_date", "conversation_id"], 
                    { user_id: userId });
                break;
                
            case 'calls':
                records = await fetchData("Call_Data", 
                    ["user_id", "created_at", "duration"], 
                    { user_id: userId });
                break;
                
            default:
                records = [];
        }
        
        paginationState.allRecords = records;
        paginationState.totalRecords = records.length;
        
        if (records.length === 0) {
            modalBody.innerHTML = '<p class="no-data">No records found for this period.</p>';
        } else {
            updateModalContent();
        }
        
    } catch (error) {
        console.error('Error loading service details:', error);
        modalBody.innerHTML = '<p class="error">Error loading data. Please try again.</p>';
    }
}

/**
 * Close the service detail modal
 */
function closeServiceModal() {
    const modal = document.getElementById('service-detail-modal');
    modal.style.display = 'none';
    
    // Reset pagination state
    paginationState = {
        currentPage: 1,
        recordsPerPage: 20,
        totalRecords: 0,
        allRecords: [],
        serviceType: null,
        userId: null,
        dates: null
    };
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
        // Use clientStartDate and clientEndDate for client tab
        const tempStart = currentStartDate;
        const tempEnd = currentEndDate;
        
        currentStartDate = clientStartDate;
        currentEndDate = clientEndDate;
        
        // Fetch all non-admin users
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { role: "user" }
        );
        console.log("Users loaded:", users);

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No users found.</td></tr>'; 
            console.warn("No users found.");
            
            // Restore revenue dates
            currentStartDate = tempStart;
            currentEndDate = tempEnd;
            return;
        }

        const dates = getDatesInRange(clientStartDate, clientEndDate);
        
        // Store globally for stat card drill-down
        allDatesInRange = dates;

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
        
        // Store globally for stat card drill-down
        allUsersData = usersWithStats;

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
        
        // Restore revenue dates
        currentStartDate = tempStart;
        currentEndDate = tempEnd;

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
 * - Summary statistics (total revenue by category) - clickable for detail view
 * - Aggregated chart by period type (daily/weekly/monthly/yearly)
 * - List of active manual packages with pricing
 * 
 * The chart aggregates by the selected date type, matching the main chart.
 * 
 * REVIEW: If adding new service types, add new stat cards and update chart logic
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
    
    hideOtherCharts('user');
    
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    // Reset stat values
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    // Smooth scroll to detail view
    document.getElementById('user-detail-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    try {
        // Use client tab dates
        const tempStart = currentStartDate;
        const tempEnd = currentEndDate;
        const tempType = currentDateType;
        
        currentStartDate = clientStartDate;
        currentEndDate = clientEndDate;
        currentDateType = document.getElementById('client-date-type').value;
        
        const dates = getDatesInRange(clientStartDate, clientEndDate);
        
        // Get revenue breakdown by date
        const revenueByDate = await getRevenueByDateForUser(user.id, dates);
        
        // Aggregate by selected period type
        const aggregatedDatabyDay = dates.map(date => ({
            date: date,
            total: parseFloat((revenueByDate[date].packages + revenueByDate[date].emails + 
                             revenueByDate[date].chats + revenueByDate[date].calls).toFixed(2)),
            packages: parseFloat(revenueByDate[date].packages.toFixed(2)),
            emails: parseFloat(revenueByDate[date].emails.toFixed(2)),
            chats: parseFloat(revenueByDate[date].chats.toFixed(2)),
            calls: parseFloat(revenueByDate[date].calls.toFixed(2))
            // REVIEW: If adding new service types, add them here
        }));
        
        const aggregatedData = aggregateDataByPeriod(aggregatedDatabyDay, currentDateType);
        const labels = aggregatedData.map(d => d.label);
        
        // Always show services as separate datasets (emails, chats, calls, packages)
        // REVIEW: If adding new service types, add new dataset objects here
        const datasets = [];
        
        // Packages dataset - hidden by default
        datasets.push({
            label: 'Packages',
            data: aggregatedData.map(d => d.packages),
            backgroundColor: chartColors.packages.border,
            hidden: true  // Hidden by default, but available in legend
        });
        
        // Active service datasets
        datasets.push({
            label: 'Emails',
            data: aggregatedData.map(d => d.emails),
            backgroundColor: chartColors.emails.border
        });
        datasets.push({
            label: 'Chats',
            data: aggregatedData.map(d => d.chats),
            backgroundColor: chartColors.chats.border
        });
        datasets.push({
            label: 'Calls',
            data: aggregatedData.map(d => d.calls),
            backgroundColor: chartColors.calls.border
        });

        // Calculate totals for summary statistics
        const totals = {
            packages: dates.reduce((sum, date) => sum + revenueByDate[date].packages, 0),
            emails: dates.reduce((sum, date) => sum + revenueByDate[date].emails, 0),
            chats: dates.reduce((sum, date) => sum + revenueByDate[date].chats, 0),
            calls: dates.reduce((sum, date) => sum + revenueByDate[date].calls, 0)
            // REVIEW: If adding new service types, add them to totals calculation
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls;

        // Update stat cards with click handlers
        // REVIEW: If adding new service types, add new stat card updates here
        const statPackages = document.getElementById('stat-packages');
        statPackages.textContent = `$${totals.packages.toFixed(2)}`;
        statPackages.onclick = () => showServiceDetail('packages', user.id, dates);
        
        const statEmails = document.getElementById('stat-emails');
        statEmails.textContent = `$${totals.emails.toFixed(2)}`;
        statEmails.onclick = () => showServiceDetail('emails', user.id, dates);
        
        const statChats = document.getElementById('stat-chats');
        statChats.textContent = `$${totals.chats.toFixed(2)}`;
        statChats.onclick = () => showServiceDetail('chats', user.id, dates);
        
        const statCalls = document.getElementById('stat-calls');
        statCalls.textContent = `$${totals.calls.toFixed(2)}`;
        statCalls.onclick = () => showServiceDetail('calls', user.id, dates);
        
        document.getElementById('stat-total').textContent = `$${totals.total.toFixed(2)}`;

        // Render stacked bar chart
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;  
        }

        const ctx = document.getElementById('revenue-chart').getContext('2d');

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
                                const index = context[0].dataIndex;
                                const periodData = aggregatedData[index];
                                if (periodData.datesInPeriod && periodData.datesInPeriod.length > 1) {
                                    return `Period: ${periodData.datesInPeriod[0]} to ${periodData.datesInPeriod[periodData.datesInPeriod.length - 1]}`;
                                }
                                return 'Date: ' + context[0].label;
                            },
                            footer: function(context) {
                                const index = context[0].dataIndex;
                                const data = aggregatedData[index];
                                // Calculate visible total (excluding hidden datasets)
                                let visibleTotal = 0;
                                context.forEach(item => {
                                    if (!item.dataset.hidden) {
                                        visibleTotal += item.parsed.y;
                                    }
                                });
                                return 'Visible Total: $' + visibleTotal.toFixed(2);
                            }
                        }
                    },
                    legend: {
                        position: 'bottom',
                        onClick: function(e, legendItem, legend) {
                            // Default Chart.js legend click behavior (toggle dataset visibility)
                            const index = legendItem.datasetIndex;
                            const chart = legend.chart;
                            const meta = chart.getDatasetMeta(index);
                            
                            // Toggle visibility
                            meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
                            
                            // Update chart
                            chart.update();
                        },
                        labels: {
                            generateLabels: function(chart) {
                                const datasets = chart.data.datasets;
                                return datasets.map((dataset, i) => {
                                    const meta = chart.getDatasetMeta(i);
                                    const hidden = meta.hidden === null ? dataset.hidden : meta.hidden;
                                    
                                    return {
                                        text: dataset.label,
                                        fillStyle: dataset.backgroundColor,
                                        strokeStyle: dataset.borderColor,
                                        lineWidth: dataset.borderWidth,
                                        hidden: hidden,
                                        datasetIndex: i
                                    };
                                });
                            }
                        }
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
                        frequency: pkg.frequency || 'Weekly',
                        created_time: pkg.created_time
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
                const createdText = pkg.created_time ? `<p class="package-created">Created: ${new Date(pkg.created_time).toLocaleDateString()}</p>` : '';
                
                pkgDiv.innerHTML = `
                    <div class="package-header">
                        <h4>${pkg.name}${countText}</h4>
                        <span class="package-badge">${pkg.frequency}</span>
                    </div>
                    <p class="package-cost">$${pkg.cost.toFixed(2)}</p>
                    ${createdText}
                `;
                packagesGrid.appendChild(pkgDiv);
            });
            
            packagesCard.style.display = 'block';
        } else {
            document.getElementById('packages-card').style.display = 'none';
        }
        
        // Restore revenue dates
        currentStartDate = tempStart;
        currentEndDate = tempEnd;
        currentDateType = tempType;

    } catch (error) {
        console.error("Error loading chart:", error);
        alert('Error loading revenue data: ' + error.message);
        
        // Restore revenue dates even on error
        currentStartDate = tempStart;
        currentEndDate = tempEnd;
        currentDateType = tempType;
    }
}

//!SECTION

// ============================================================================
// SECTION: Navigation
// ============================================================================
/**
 * open categories from links on the sidebar
 * 
 * - checks if name is in array
 * - goes through array
 * - if it is the same name sets display to block
 * - if not sets display to none
 * 
 * @param {any} name -id of the tab to open
 * 
 * @return none
 */
function openSidebar(name) {
    name=String(name);
    console.log(`tab name is ${name}`)
    const availableTabs = ['revenue-content', 'client-content', 'commissions-content', 'pending-invoices']; 
    
    // Check if the requested tab name is valid
    if (!availableTabs.includes(name)) {
        console.warn(`Attempted to open unknown tab: ${name}`);
        return; // Exit the function early if the tab is not found
    }

    // Use forEach to iterate directly over the tab names
    availableTabs.forEach(tabName => {
        const thisTab = document.getElementById(tabName);
        console.log(`attempting to open: ${thisTab} aka ${name}`)
        // Use the Ternary Operator for a concise show/hide check
        if (thisTab) {
            thisTab.style.display = (tabName === name) ? 'block' : 'none';
        } else {
            console.error(`Element with ID '${tabName}' not found.`);
        }
    });
    
    // Hide all charts when switching tabs
    if (name !== 'revenue-content') {
        hideOtherCharts('none');
    }
}
//!SECTION

// ============================================================================
// SECTION: Initialization
// ============================================================================

/**
 * Initialize the application when DOM is ready
 * 
 * Sets up:
 * - Default date range (last Sunday to today)
 * - Event listeners for date inputs and controls
 * - Modal close handlers
 * - Initial data load
 * 
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements for revenue tab
    const startDateInput = document.getElementById("start-date");
    const endDateInput = document.getElementById("end-date");
    const currentDateTypeInput = document.getElementById("date-type");
    const loadButton = document.getElementById("load-users");
    
    // Get DOM elements for client tab
    const clientStartDateInput = document.getElementById("client-start-date");
    const clientEndDateInput = document.getElementById("client-end-date");
    const clientDateTypeInput = document.getElementById("client-date-type");
    const loadClientsButton = document.getElementById("load-clients");

    // Set default date range (last Sunday to today)
    const today = new Date();
    const lastSunday = getLastSunday();
    
    // Revenue tab defaults
    currentEndDate = formatDate(today);
    currentStartDate = formatDate(lastSunday);
    currentDateType = '1'; // Daily view by default
    
    startDateInput.value = currentStartDate;
    endDateInput.value = currentEndDate;
    currentDateTypeInput.value = currentDateType;
    
    // Client tab defaults
    clientEndDate = formatDate(today);
    clientStartDate = formatDate(lastSunday);
    
    clientStartDateInput.value = clientStartDate;
    clientEndDateInput.value = clientEndDate;
    clientDateTypeInput.value = '1'; // Daily view by default
    
    // Revenue tab date change event handlers
    startDateInput.addEventListener('change', (e) => {
        currentStartDate = e.target.value;
        sessionCache.clear(); 
    });
    
    endDateInput.addEventListener('change', (e) => {
        currentEndDate = e.target.value;
        sessionCache.clear();
    });

    currentDateTypeInput.addEventListener('change', (e) => {
        currentDateType = e.target.value;
        sessionCache.clear();
    });
    
    // Client tab date change event handlers
    clientStartDateInput.addEventListener('change', (e) => {
        clientStartDate = e.target.value;
        sessionCache.clear(); 
    });
    
    clientEndDateInput.addEventListener('change', (e) => {
        clientEndDate = e.target.value;
        sessionCache.clear();
    });

    clientDateTypeInput.addEventListener('change', (e) => {
        sessionCache.clear();
    });
    
    // Revenue tab load button handler
    loadButton.addEventListener('click', async () => {
        sessionCache.clear();
        
        // Fetch users and render main chart
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { role: "user" }
        );
        
        if (users.length > 0) {
            const dates = getDatesInRange(currentStartDate, currentEndDate);
            allDatesInRange = dates;
            
            // Calculate stats for all users
            const statsPromises = users.map(async user => {
                const packageStats = await getPackageStatsForUser(user.id);
                const totalRevenue = await getTotalRevenueForUser(user.id, dates);
                return { ...user, ...packageStats, totalRevenue };
            });
            const usersWithStats = await Promise.all(statsPromises);
            allUsersData = usersWithStats;
            
            await renderMainClientChart(usersWithStats, dates, currentDateType);
        }
    });
    
    // Client tab load button handler
    loadClientsButton.addEventListener('click', () => {
        sessionCache.clear(); 
        loadUsers();
        // Hide detail views on reload
        hideOtherCharts('none');
    });

    // Modal close handlers
    const modal = document.getElementById('service-detail-modal');
    const closeBtn = document.querySelector('.close-modal');
    
    if (closeBtn) {
        closeBtn.onclick = closeServiceModal;
    }
    
    window.onclick = function(event) {
        if (event.target == modal) {
            closeServiceModal();
        }
    };

    // Initialize back button functionality
    deployBackbutton();

    // Initialize application
    loadUsers();

    //show revenue section and start that chart
    openSidebar("revenue-content");

    (async () => {
        // Fetch users and render main chart
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { role: "user" }
        );
        
        if (users.length > 0) {
            const dates = getDatesInRange(currentStartDate, currentEndDate);
            allDatesInRange = dates;
            
            // Calculate stats for all users
            const statsPromises = users.map(async user => {
                const packageStats = await getPackageStatsForUser(user.id);
                const totalRevenue = await getTotalRevenueForUser(user.id, dates);
                return { ...user, ...packageStats, totalRevenue };
            });
            const usersWithStats = await Promise.all(statsPromises);
            allUsersData = usersWithStats;
            
            await renderMainClientChart(usersWithStats, dates, currentDateType);
        }
    })();

});

//!SECTION


/**
 * ============================================================================
 * END OF APPLICATION
 * ============================================================================
 */