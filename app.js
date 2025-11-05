//app.js 
// SECTION: Global variables
const API_ENDPOINT = "https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb";
const CACHE_ENDPOINT = "/cache.php"; // Update this to your actual PHP cache endpoint
let chartInstance = null; // For user detail chart
let mainChartInstance = null; // For main page chart
let radarChartInstance = null; // For daily revenue radar chart
let currentUser = null;
let currentStartDate = null;
let currentEndDate = null;
let currentDateType = null;
//!SECTION

// SECTION - PHP-based session cache
const sessionCache = {
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
    
    async get(key, maxAge = 300000) { // Default 5 min cache
        try {
            const response = await fetch(`${CACHE_ENDPOINT}?key=${encodeURIComponent(key)}&maxAge=${maxAge}`);
            const result = await response.json();
            return result.success ? result.data : null;
        } catch (error) {
            console.error("Cache get error:", error);
            return null;
        }
    },
    
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

/* SECTION: Date Helper Functions */
const formatDate = (date) => {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}

const getLastSunday = () => {
    const today = new Date();
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - today.getDay());
    return lastSunday;
}

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

const addDaysToDate = (dateString, days) => {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return formatDate(date);
}
//!SECTION

/** SECTION: Fetch function with caching **/
async function fetchData(tableName, columns, filters = {}) {
    const cacheKey = JSON.stringify({ tableName, columns, filters });
    
    // Check cache first
    const cached = await sessionCache.get(cacheKey);
    if (cached) {
        console.log(`Using cached data for: ${tableName}`);
        return cached;
    }
    
    console.log(`Fetching data from table: ${tableName} with filters:`, filters);
    
    // Add date filters if they exist globally
    const enhancedFilters = { ...filters };
    if (currentStartDate && currentEndDate) {
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
            //NOTE - dates need to be adjusted to count in the filter
            
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

// SECTION: Helper function to get package stats
async function getPackageStatsForUser(userId) {
    const packages = await fetchData("manual_charges", ["user_id", "cost", "name","frequency"], { user_id: userId }); //FIXME - the frequency matters adapt the rest of this code around that
    const packageCount = packages.length;
    const weeklyPackageRevenue = packages.reduce((sum, pkg) => {
        return sum + (parseFloat(pkg.cost) || 0);
    }, 0);
    const packageNames = packages.map(pkg => pkg.name).filter(n => n).join(', ') || 'None';
    return { packageCount, weeklyPackageRevenue, packageNames, packages };
}

async function getRevenueByDateForUser(userId, dates) {
    const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts] = await Promise.all([
        fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: userId }),
        fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: userId }),
        fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: userId }),
        fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: userId })
    ]);

    const revenueByDate = {};
    dates.forEach(date => {
        revenueByDate[date] = {
            packages: 0,
            emails: 0,
            chats: 0,
            calls: 0
        };
    });

    // Calculate daily package cost
    //FIXME there is often multiple packages and thus multiple entries uner the same user
    let totalPackageCostByDay = 0;
    packages.forEach(pkg =>{
        let PackageCost
        let dailyPackageCost = 0;
        if(pkg.frequency == 'Weekly'){
            PackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
            dailyPackageCost = PackageCost/7;
        }
        if(pkg.frequency == 'Monthly'){
            PackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
            dailyPackageCost = PackageCost/30.5;
        } //REVIEW - are there options besides weekly and monthly?
        totalPackageCostByDay += dailyPackageCost;
    })

    // const weeklyPackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
    // const dailyPackageCost = weeklyPackageCost / 7;
    dates.forEach(date => {
        revenueByDate[date].packages = totalPackageCostByDay;
    });

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Process email costs
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

    // Process chat costs
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

    // Process call costs
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

    return revenueByDate;
}

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

// SECTION: Radar Chart for Revenue Breakdown - Fixed to show users on axis
async function showRadarChart(period,users) {
    const radarContainer = document.getElementById('radar-chart-container');
    const radarCanvas = document.getElementById('radar-chart');
    const datesInPeriod = period.datesInPeriod;
    
    const dateDisplay = datesInPeriod > 1 ? '${datesInPeriod[0]} to  ${datesInPeriod[-1]}' :period.label;
    
    radarContainer.style.display = 'block';
    document.getElementById('radar-date').textContent = dateDisplay;
    
    //if chart exists remove it
    if (radarChartInstance) {
        radarChartInstance.destroy();
    }
    
    //get date range
    const allDatesInCurrentRange = getDatesInRange(currentStartDate,currentEndDate);


    // Get revenue data for period
    const userRevenuePromises = users.map(async (user) => {
        const revenueByDate = await getRevenueByDateForUser(user.id, allDatesInCurrentRange);
        let aggregatedRevenue = {emails:0,chats:0,calls:0};//start out with everything at 0
        //sum everything
        datesInPeriod.forEach(date =>{
            const dayRevenue=revenueByDate[date];
            if(dayRevenue){
                aggregatedRevenue.packages+=dayRevenue.packages;
                aggregatedRevenue.emails+=dayRevenue.emails;
                aggregatedRevenue.chats+=dayRevenue.chats;
                aggregatedRevenue.calls+=dayRevenue.calls;
            }
        })
        return {
            userId: user.id,
            userName: `${user.first_name} ${user.last_name}`,
            revenue: aggregatedRevenue
        };
    });
    
    const userRevenueData = await Promise.all(userRevenuePromises);
    console.log('user revenue data below');
    console.log(userRevenueData);
    
    // Create datasets for each revenue type
    const datasets = [ //FIXME this section needs styling from styles.css
        {
            label: 'Packages',
            data: userRevenueData.map(u => u.revenue.packages),
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            borderColor: 'rgba(99, 102, 241, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(99, 102, 241, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(99, 102, 241, 1)'
        },
        {
            label: 'Emails',
            data: userRevenueData.map(u => u.revenue.emails),
            backgroundColor: 'rgba(251, 191, 36, 0.2)',
            borderColor: 'rgba(251, 191, 36, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(251, 191, 36, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(251, 191, 36, 1)'
        },
        {
            label: 'Chats',
            data: userRevenueData.map(u => u.revenue.chats),
            backgroundColor: 'rgba(20, 184, 166, 0.2)',
            borderColor: 'rgba(20, 184, 166, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(20, 184, 166, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(20, 184, 166, 1)'
        },
        {
            label: 'Calls',
            data: userRevenueData.map(u => u.revenue.calls),
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            borderColor: 'rgba(239, 68, 68, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(239, 68, 68, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(239, 68, 68, 1)'
        }
    ];
    console.log('radar datanxt');
    console.log(datasets);
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

//SECTION - sunction to aggregate data by period
function aggregateDataByPeriod(aggregatedDatabyDay, dateType) {
        const type = parseInt(dateType);
        
        // Default to daily if not 7 or 30
        if (type !== 7 && type !== 30) { 
            return aggregatedDatabyDay.map(d => ({
                label: d.date,
                total: d.total,
                packages: d.packages,
                emails: d.emails,
                chats: d.chats,
                calls: d.calls,
                datesInPeriod: [d.date] // Daily period is just the single date
            }));
        }

        const aggregated = {};

        aggregatedDatabyDay.forEach(day => {
            console.log('here');
            console.log(day);
            const dateObj = new Date(day.date);
            let key = day.date; 

            if (type === 7) { // Weekly
                // Calculate the Sunday (start of the week) for the period key
                const dayOfWeek = dateObj.getDay(); // 0 is Sunday, 6 is Saturday
                const weekStart = new Date(dateObj);
                weekStart.setDate(dateObj.getDate() - dayOfWeek);
                key = formatDate(weekStart); 
            } else if (type === 30) { // Monthly
                // Use YYYY-MM as the key
                key = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
            }

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

            aggregated[key].total += day.total;
            aggregated[key].packages += day.packages;
            aggregated[key].emails += day.emails;
            aggregated[key].chats += day.chats;
            aggregated[key].calls += day.calls;
            aggregated[key].datesInPeriod.push(day.date);
        });

        //console check
        console.log(aggregated);
        // Final formatting and sorting
        return Object.values(aggregated).map(d => {
            d.datesInPeriod.sort(); // Sort dates chronologically for range display
            
            // Update label for display
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
            // Sort by the earliest date in the period for correct chronological order
            const dateA = new Date(a.datesInPeriod[0] || a.label);
            const dateB = new Date(b.datesInPeriod[0] || b.label);
            return dateA.getTime() - dateB.getTime();
        });
    }
//!SECTION



// SECTION: Main Chart Rendering - Line Graph by Date
//TODO: add funtion documentation
async function renderMainClientChart(users, dates, dateType) {
    const ctx = document.getElementById('main-revenue-chart').getContext('2d');
    
    //clear out old chart
    if (mainChartInstance) {
        mainChartInstance.destroy();
    }

    // Fetch revenue by date for all users
    const revenuePromises = users.map(user => getRevenueByDateForUser(user.id, dates));
    const userRevenueByDate = await Promise.all(revenuePromises);

    // Aggregate revenue by date and category across users 
    //NOTE THIS IS NEEDED REGARDLESS OF DATE RANGE OR TYPE SO WE CAN AGGREGATE DATES LATER

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

    //Aggregate revenue by range 
    const aggregatedData = aggregateDataByPeriod(aggregatedDatabyDay,dateType);

    const chartLabels = aggregatedData.map(d=>d.label);
    const chartTotals = aggregatedData.map(d=>d.total);

    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Total Revenue',
                data: chartTotals,
                borderColor: 'rgba(99, 102, 241, 1)', //FIXME - change to styles.css colors
                backgroundColor: 'rgba(99, 102, 241, 0.1)',//FIXME - change to styles.css colors
                borderWidth: 3,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 8,
                trendlineLinear:{
                    lineStyle: "dotted",
                    width: 2
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: async (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const clickedPeriod = aggregatedData[index];
                    await showRadarChart(clickedPeriod,users);
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
                    display: false //its ugly and there is only 1 line
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

// SECTION: Load users table
async function loadUsers() {
    console.log("Loading users...");
    const tbody = document.getElementById('users-tbody');
    
    try {
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

        // Fetch package stats and total revenue for all users concurrently
        const statsPromises = users.map(async user => {
            const packageStats = await getPackageStatsForUser(user.id);
            const totalRevenue = await getTotalRevenueForUser(user.id, dates);
            return { ...packageStats, totalRevenue };
        });
        const userStats = await Promise.all(statsPromises);
        console.log("User stats loaded:", userStats);

        // Combine users and stats
        const usersWithStats = users.map((user, index) => ({
            ...user,
            ...userStats[index]
        }));

        // Sort by revenue (descending)
        usersWithStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

        tbody.innerHTML = '';
        usersWithStats.forEach((user, index) => {
            console.log("Rendering user:", user);
            
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'even' : 'odd';

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
            tr.addEventListener('click', () => showUserDetail(user));
            tbody.appendChild(tr);
        });
        
        // Render the main chart with date range
        await renderMainClientChart(usersWithStats, dates, currentDateType);

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="error">Error loading users: ${error.message}</td></tr>`;
        console.error("Error loading users:", error);
    }
}
//!SECTION

// SECTION: User detail
async function showUserDetail(user) {
    console.log("Showing details for user:", user);
    currentUser = user;
    
    const detailView = document.getElementById('user-detail-view');
    detailView.style.display = 'block';
    
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    // Scroll to detail view
    detailView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    try {
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        
        // Get revenue by actual date
        const revenueByDate = await getRevenueByDateForUser(user.id, dates);
        
        // Prepare data for chart by date (excluding packages)
        const labels = dates;
        const datasets = [
            {
                label: 'Emails',
                data: labels.map(date => parseFloat(revenueByDate[date].emails.toFixed(2))),
                backgroundColor: 'rgba(251, 191, 36, 0.8)'
            },
            {
                label: 'Chats',
                data: labels.map(date => parseFloat(revenueByDate[date].chats.toFixed(2))),
                backgroundColor: 'rgba(20, 184, 166, 0.8)'
            },
            {
                label: 'Calls',
                data: labels.map(date => parseFloat(revenueByDate[date].calls.toFixed(2))),
                backgroundColor: 'rgba(99, 102, 241, 0.8)'
            }
        ];

        const totals = {
            packages: labels.reduce((sum, date) => sum + revenueByDate[date].packages, 0),
            emails: datasets[0].data.reduce((sum, val) => sum + val, 0),
            chats: datasets[1].data.reduce((sum, val) => sum + val, 0),
            calls: datasets[2].data.reduce((sum, val) => sum + val, 0)
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls;

        document.getElementById('stat-packages').textContent = `$${totals.packages.toFixed(2)}`;
        document.getElementById('stat-emails').textContent = `$${totals.emails.toFixed(2)}`;
        document.getElementById('stat-chats').textContent = `$${totals.chats.toFixed(2)}`;
        document.getElementById('stat-calls').textContent = `$${totals.calls.toFixed(2)}`;
        document.getElementById('stat-total').textContent = `$${totals.total.toFixed(2)}`;

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

        // Display packages separately
        if (user.packages && user.packages.length > 0) {
            const packagesCard = document.getElementById('packages-card');
            const packagesGrid = document.getElementById('packages-grid');
            
            // Aggregate packages by name
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

// SECTION: Tab Management
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

// SECTION: Initialization and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // //SECTION - Variables
    const startDateInput = document.getElementById("start-date");
    const endDateInput = document.getElementById("end-date");
    const currentDateTypeInput = document.getElementById("date-type");
    const loadButton = document.getElementById("load-users");
    // //!SECTION

    // SECTION - Set default dates & type
    const today = new Date();
    const lastSunday = getLastSunday();
    
    currentEndDate = formatDate(today);
    currentStartDate = formatDate(lastSunday);
    currentDateType ='1';
    
    startDateInput.value = currentStartDate;
    endDateInput.value = currentEndDate;
    currentDateTypeInput.value = currentDateType;
    //!SECTION
    // SECTION - Date change handlers
    startDateInput.addEventListener('change', (e) => {
        currentStartDate = e.target.value;
        sessionCache.clear(); // Clear cache on date change
    });
    
    endDateInput.addEventListener('change', (e) => {
        currentEndDate = e.target.value;
        sessionCache.clear(); // Clear cache on date change
    });

    currentDateTypeInput.addEventListener('change',(e)=>{
        currentDateType=e.target.value;
        sessionCache.clear();
    });
    //!SECTION
    
    // SECTION - Load button handler
    loadButton.addEventListener('click', () => {
        sessionCache.clear(); // Clear cache on manual reload
        loadUsers();
        document.getElementById('user-detail-view').style.display = 'none'; 
        document.getElementById('radar-chart-container').style.display = 'none';
    });
    //!SECTION

    // SECTION - Tab handlers
    const clientsTab = document.getElementById('clients-tab');
    const commissionsTab = document.getElementById('commissions-tab');
    
    if (clientsTab) {
        clientsTab.addEventListener('click', () => switchTab('clients'));
    }
    
    if (commissionsTab) {
        commissionsTab.addEventListener('click', () => switchTab('commissions'));
    }
    //!SECTION
    // SECTION Initialize
    switchTab('clients');
    loadUsers();
});
//!SECTION
//