//app.js 
// SECTION: Global variables
const API_ENDPOINT = "https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb";
let chartInstance = null; // For user detail chart
let mainChartInstance = null; // For main page chart
let currentUser = null;
let currentStartDate = null;
let currentEndDate = null;
const listElements = ['userform', 'users-table', 'main-client-chart']; // Elements visible in the list view
//!SECTION

// SECTION: Date Helper Functions
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

const getDayOfWeekFromDate = (dateString) => {
    const date = new Date(dateString);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
}

const addDaysToDate = (dateString, days) => {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return formatDate(date);
}
//!SECTION

// SECTION: Fetch function
async function fetchData(tableName, columns, filters = {}, options={}) {
    console.log(`Fetching data from table: ${tableName} with filters:`, filters);
    
    // Add date filters if they exist globally
    const enhancedFilters = { ...filters };
    if (currentStartDate && currentEndDate) {
        // Different tables use different date column names
        const dateColumnMap = {
            'Daily_Email_Cost_Record': 'created_date',
            'Daily_Chat_Record_Cost_Record': 'created_date',
            'Daily_Calls_Cost_Record': 'created_date',
            'Invoices_Pending': 'datecreated',
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
    
    if (Array.isArray(result)) return result;
    if (result && typeof result === "object") {
        return result.rows || result.data || result.result || [];
    }
    console.error("No data found in expected format for table:", tableName);
    return [];
}
//!SECTION

// SECTION: Helper function to get package stats
async function getPackageStatsForUser(userId) {
    const packages = await fetchData("manual_charges", ["user_id", "cost"], { user_id: userId });
    const packageCount = packages.length;
    const weeklyPackageRevenue = packages.reduce((sum, pkg) => {
        return sum + (parseFloat(pkg.cost) || 0);
    }, 0);
    return { packageCount, weeklyPackageRevenue };
}

async function getRevenueByDateForUser(userId, dates) {
    const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
        fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: userId }),
        fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: userId }),
        fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: userId }),
        fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: userId }),
        fetchData("Invoices_Pending", ["user_id", "paymentamount", "dateended"], { user_id: userId })
    ]);

    const revenueByDate = {};
    dates.forEach(date => {
        revenueByDate[date] = {
            packages: 0,
            emails: 0,
            chats: 0,
            calls: 0,
            invoices: 0
        };
    });

    // Calculate daily package cost
    const weeklyPackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
    const dailyPackageCost = weeklyPackageCost / 7;
    dates.forEach(date => {
        revenueByDate[date].packages = dailyPackageCost;
    });

    // Process weekly records - map each day of the week to actual dates
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

    // Process invoices - assign to specific date
    invoices.forEach(invoice => {
        const amount = parseFloat(invoice.paymentamount) || 0;
        const invoiceDate = formatDate(new Date(invoice.dateended));
        if (revenueByDate[invoiceDate]) {
            revenueByDate[invoiceDate].invoices += amount;
        }
    });

    return revenueByDate;
}
//!SECTION

// SECTION: View Management
function toggleViews(view) {
    const userDetailView = document.getElementById('user-detail-view');

    if (view === 'detail') {
        listElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        userDetailView.style.display = 'block';
    } else {
        userDetailView.style.display = 'none';
        listElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
    }
}
//!SECTION

// SECTION: Main Chart Rendering - Line Graph by Date
async function renderMainClientChart(users, dates) {
    const ctx = document.getElementById('main-revenue-chart').getContext('2d');
    
    if (mainChartInstance) {
        mainChartInstance.destroy();
    }

    // Fetch revenue by date for all users
    const revenuePromises = users.map(user => getRevenueByDateForUser(user.id, dates));
    const userRevenueByDate = await Promise.all(revenuePromises);

    // Aggregate total revenue by date across all users
    const totalRevenueByDate = dates.map(date => {
        let dayTotal = 0;
        userRevenueByDate.forEach(userRevenue => {
            const dayRevenue = userRevenue[date];
            dayTotal += dayRevenue.packages + dayRevenue.emails + dayRevenue.chats + dayRevenue.calls + dayRevenue.invoices;
        });
        return parseFloat(dayTotal.toFixed(2));
    });

    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Total Revenue',
                data: totalRevenueByDate,
                borderColor: 'rgba(139, 92, 246, 1)',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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
                            return ''
//!SECTION

// SECTION: Load users table
async function loadUsers() {
    console.log("Loading users...");
    const tbody = document.getElementById('users-tbody');
    
    try {
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { is_admin: "0" }
        );
        console.log("Users loaded:", users);

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No users found.</td></tr>'; 
            console.warn("No users found.");
            return;
        }

        // Fetch package stats for all users concurrently
        const statsPromises = users.map(user => getPackageStatsForUser(user.id));
        const userStats = await Promise.all(statsPromises);
        console.log("User stats loaded:", userStats);

        // Combine users and stats
        const usersWithStats = users.map((user, index) => ({
            ...user,
            ...userStats[index]
        }));

        // Sort by revenue (descending)
        usersWithStats.sort((a, b) => b.weeklyPackageRevenue - a.weeklyPackageRevenue);

        tbody.innerHTML = '';
        usersWithStats.forEach((user, index) => {
            console.log("Rendering user:", user);
            
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'even' : 'odd';

            const revenueText = `$${user.weeklyPackageRevenue.toFixed(2)}`; 
            const packageText = user.packageCount;

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
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        await renderMainClientChart(usersWithStats, dates);
        
        toggleViews('list');

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
    
    toggleViews('detail');
    
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    try {
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
            fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: user.id }),
            fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: user.id }),
            fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: user.id }),
            fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: user.id }),
            fetchData("Invoices_Pending", ["user_id", "paymentamount", "dateended"], { user_id: user.id })
        ]);

        const revenueByDay = {};
        daysOfWeek.forEach(day => {
            revenueByDay[day] = { packages: 0, emails: 0, chats: 0, calls: 0, invoices: 0 };
        });

        const weeklyPackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
        const dailyPackageCost = weeklyPackageCost / 7;
        daysOfWeek.forEach(day => {
            revenueByDay[day].packages = dailyPackageCost;
        });

        // Process email costs
        dailyEmailCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const emails = week[day].emails || 0;
                    const threshold = week[day].email_threshold || 0;
                    const overage = Math.max(0, emails - threshold);
                    const cost = overage * (week[day].email_cost_overage || 0);
                    revenueByDay[day].emails += cost;
                }
            });
        });

        // Process chat costs
        dailyChatCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const dailyCost = week[day].daily_cost || week[day].chats * (week[day].chat_per_conversation_cost || 0);
                    revenueByDay[day].chats += dailyCost || 0;
                }
            });
        });

        // Process call costs
        dailyCallsCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const cost = week[day].cost || week[day].daily_cost || (week[day].minutes || 0) * (week[day].cost_per_minute || 0);
                    revenueByDay[day].calls += cost || 0;
                }
            });
        });

        // Process invoices
        invoices.forEach(invoice => {
            const amount = parseFloat(invoice.paymentamount) || 0;
            const date = new Date(invoice.dateended);
            const dayName = daysOfWeek[date.getDay()];
            if (revenueByDay[dayName]) {
                revenueByDay[dayName].invoices += amount / 7;
            }
        });

        const labels = daysOfWeek;
        const datasets = [
            {
                label: 'Packages',
                data: labels.map(day => parseFloat(revenueByDay[day].packages.toFixed(2))),
                backgroundColor: 'rgba(139, 92, 246, 0.8)'
            },
            {
                label: 'Emails',
                data: labels.map(day => parseFloat(revenueByDay[day].emails.toFixed(2))),
                backgroundColor: 'rgba(251, 191, 36, 0.8)'
            },
            {
                label: 'Chats',
                data: labels.map(day => parseFloat(revenueByDay[day].chats.toFixed(2))),
                backgroundColor: 'rgba(20, 184, 166, 0.8)'
            },
            {
                label: 'Calls',
                data: labels.map(day => parseFloat(revenueByDay[day].calls.toFixed(2))),
                backgroundColor: 'rgba(99, 102, 241, 0.8)'
            },
            {
                label: 'Invoices',
                data: labels.map(day => parseFloat(revenueByDay[day].invoices.toFixed(2))),
                backgroundColor: 'rgba(239, 68, 68, 0.8)'
            }
        ];

        const totals = {
            packages: datasets[0].data.reduce((sum, val) => sum + val, 0),
            emails: datasets[1].data.reduce((sum, val) => sum + val, 0),
            chats: datasets[2].data.reduce((sum, val) => sum + val, 0),
            calls: datasets[3].data.reduce((sum, val) => sum + val, 0),
            invoices: datasets[4].data.reduce((sum, val) => sum + val, 0)
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls + totals.invoices;

        document.getElementById('stat-packages').textContent = `$${totals.packages.toFixed(2)}`;
        document.getElementById('stat-emails').textContent = `$${totals.emails.toFixed(2)}`;
        document.getElementById('stat-chats').textContent = `$${totals.chats.toFixed(2)}`;
        document.getElementById('stat-calls').textContent = `$${totals.calls.toFixed(2)}`;
        document.getElementById('stat-invoices').textContent = `$${totals.invoices.toFixed(2)}`;
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
                        grid: { display: false }
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
                            footer: function(tooltipItems) {
                                let total = 0;
                                tooltipItems.forEach(item => {
                                    total += item.parsed.y;
                                });
                                return 'Total: $' + total.toFixed(2);
                            },
                            label: function(context) {
                                return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                            }
                        }
                    },
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });

        if (packages.length > 0) {
            const packagesCard = document.getElementById('packages-card');
            const packagesGrid = document.getElementById('packages-grid');
            
            packagesGrid.innerHTML = '';
            packages.forEach(pkg => {
                const pkgDiv = document.createElement('div');
                pkgDiv.className = 'package-item';
                
                pkgDiv.innerHTML = `
                    <div class="package-header">
                        <h4>${pkg.name}</h4>
                        <span class="package-badge">${pkg.frequency}</span>
                    </div>
                    <p class="package-cost">$${parseFloat(pkg.cost).toFixed(2)}</p>
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

// SECTION: Initialization and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById("start-date");
    const endDateInput = document.getElementById("end-date");
    const loadButton = document.getElementById("load-users");
    
    // Set default dates
    const today = new Date();
    const lastSunday = getLastSunday();
    
    currentEndDate = formatDate(today);
    currentStartDate = formatDate(lastSunday);
    
    startDateInput.value = currentStartDate;
    endDateInput.value = currentEndDate;
    
    // Date change handlers
    startDateInput.addEventListener('change', (e) => {
        currentStartDate = e.target.value;
    });
    
    endDateInput.addEventListener('change', (e) => {
        currentEndDate = e.target.value;
    });
    
    // Load button handler
    loadButton.addEventListener('click', () => {
        loadUsers();
    });
    
    // Back Button Handler
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            toggleViews('list');
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
        });
    }

    // Initialize the dashboard
    loadUsers();
});
//!SECTION + value.toFixed(2);
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
                    text: 'Total Daily Revenue (All Clients)'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Total Revenue: '
//!SECTION

// SECTION: Load users table
async function loadUsers() {
    console.log("Loading users...");
    const tbody = document.getElementById('users-tbody');
    
    try {
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { is_admin: "0" }
        );
        console.log("Users loaded:", users);

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No users found.</td></tr>'; 
            console.warn("No users found.");
            return;
        }

        // Fetch package stats for all users concurrently
        const statsPromises = users.map(user => getPackageStatsForUser(user.id));
        const userStats = await Promise.all(statsPromises);
        console.log("User stats loaded:", userStats);

        // Combine users and stats
        const usersWithStats = users.map((user, index) => ({
            ...user,
            ...userStats[index]
        }));

        // Sort by revenue (descending)
        usersWithStats.sort((a, b) => b.weeklyPackageRevenue - a.weeklyPackageRevenue);

        tbody.innerHTML = '';
        usersWithStats.forEach((user, index) => {
            console.log("Rendering user:", user);
            
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'even' : 'odd';

            const revenueText = `$${user.weeklyPackageRevenue.toFixed(2)}`; 
            const packageText = user.packageCount;

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
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        await renderMainClientChart(usersWithStats, dates);
        
        toggleViews('list');

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
    
    toggleViews('detail');
    
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    try {
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
            fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: user.id }),
            fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: user.id }),
            fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: user.id }),
            fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: user.id }),
            fetchData("Invoices_Pending", ["user_id", "paymentamount", "dateended"], { user_id: user.id })
        ]);

        const revenueByDay = {};
        daysOfWeek.forEach(day => {
            revenueByDay[day] = { packages: 0, emails: 0, chats: 0, calls: 0, invoices: 0 };
        });

        const weeklyPackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
        const dailyPackageCost = weeklyPackageCost / 7;
        daysOfWeek.forEach(day => {
            revenueByDay[day].packages = dailyPackageCost;
        });

        // Process email costs
        dailyEmailCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const emails = week[day].emails || 0;
                    const threshold = week[day].email_threshold || 0;
                    const overage = Math.max(0, emails - threshold);
                    const cost = overage * (week[day].email_cost_overage || 0);
                    revenueByDay[day].emails += cost;
                }
            });
        });

        // Process chat costs
        dailyChatCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const dailyCost = week[day].daily_cost || week[day].chats * (week[day].chat_per_conversation_cost || 0);
                    revenueByDay[day].chats += dailyCost || 0;
                }
            });
        });

        // Process call costs
        dailyCallsCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const cost = week[day].cost || week[day].daily_cost || (week[day].minutes || 0) * (week[day].cost_per_minute || 0);
                    revenueByDay[day].calls += cost || 0;
                }
            });
        });

        // Process invoices
        invoices.forEach(invoice => {
            const amount = parseFloat(invoice.paymentamount) || 0;
            const date = new Date(invoice.dateended);
            const dayName = daysOfWeek[date.getDay()];
            if (revenueByDay[dayName]) {
                revenueByDay[dayName].invoices += amount / 7;
            }
        });

        const labels = daysOfWeek;
        const datasets = [
            {
                label: 'Packages',
                data: labels.map(day => parseFloat(revenueByDay[day].packages.toFixed(2))),
                backgroundColor: 'rgba(139, 92, 246, 0.8)'
            },
            {
                label: 'Emails',
                data: labels.map(day => parseFloat(revenueByDay[day].emails.toFixed(2))),
                backgroundColor: 'rgba(251, 191, 36, 0.8)'
            },
            {
                label: 'Chats',
                data: labels.map(day => parseFloat(revenueByDay[day].chats.toFixed(2))),
                backgroundColor: 'rgba(20, 184, 166, 0.8)'
            },
            {
                label: 'Calls',
                data: labels.map(day => parseFloat(revenueByDay[day].calls.toFixed(2))),
                backgroundColor: 'rgba(99, 102, 241, 0.8)'
            },
            {
                label: 'Invoices',
                data: labels.map(day => parseFloat(revenueByDay[day].invoices.toFixed(2))),
                backgroundColor: 'rgba(239, 68, 68, 0.8)'
            }
        ];

        const totals = {
            packages: datasets[0].data.reduce((sum, val) => sum + val, 0),
            emails: datasets[1].data.reduce((sum, val) => sum + val, 0),
            chats: datasets[2].data.reduce((sum, val) => sum + val, 0),
            calls: datasets[3].data.reduce((sum, val) => sum + val, 0),
            invoices: datasets[4].data.reduce((sum, val) => sum + val, 0)
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls + totals.invoices;

        document.getElementById('stat-packages').textContent = `$${totals.packages.toFixed(2)}`;
        document.getElementById('stat-emails').textContent = `$${totals.emails.toFixed(2)}`;
        document.getElementById('stat-chats').textContent = `$${totals.chats.toFixed(2)}`;
        document.getElementById('stat-calls').textContent = `$${totals.calls.toFixed(2)}`;
        document.getElementById('stat-invoices').textContent = `$${totals.invoices.toFixed(2)}`;
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
                        grid: { display: false }
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
                            footer: function(tooltipItems) {
                                let total = 0;
                                tooltipItems.forEach(item => {
                                    total += item.parsed.y;
                                });
                                return 'Total: $' + total.toFixed(2);
                            },
                            label: function(context) {
                                return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                            }
                        }
                    },
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });

        if (packages.length > 0) {
            const packagesCard = document.getElementById('packages-card');
            const packagesGrid = document.getElementById('packages-grid');
            
            packagesGrid.innerHTML = '';
            packages.forEach(pkg => {
                const pkgDiv = document.createElement('div');
                pkgDiv.className = 'package-item';
                
                pkgDiv.innerHTML = `
                    <div class="package-header">
                        <h4>${pkg.name}</h4>
                        <span class="package-badge">${pkg.frequency}</span>
                    </div>
                    <p class="package-cost">$${parseFloat(pkg.cost).toFixed(2)}</p>
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

// SECTION: Initialization and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById("start-date");
    const endDateInput = document.getElementById("end-date");
    const loadButton = document.getElementById("load-users");
    
    // Set default dates
    const today = new Date();
    const lastSunday = getLastSunday();
    
    currentEndDate = formatDate(today);
    currentStartDate = formatDate(lastSunday);
    
    startDateInput.value = currentStartDate;
    endDateInput.value = currentEndDate;
    
    // Date change handlers
    startDateInput.addEventListener('change', (e) => {
        currentStartDate = e.target.value;
    });
    
    endDateInput.addEventListener('change', (e) => {
        currentEndDate = e.target.value;
    });
    
    // Load button handler
    loadButton.addEventListener('click', () => {
        loadUsers();
    });
    
    // Back Button Handler
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            toggleViews('list');
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
        });
    }

    // Initialize the dashboard
    loadUsers();
});
//!SECTION + context.parsed.y.toFixed(2);
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
            { is_admin: "0" }
        );
        console.log("Users loaded:", users);

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No users found.</td></tr>'; 
            console.warn("No users found.");
            return;
        }

        // Fetch package stats for all users concurrently
        const statsPromises = users.map(user => getPackageStatsForUser(user.id));
        const userStats = await Promise.all(statsPromises);
        console.log("User stats loaded:", userStats);

        // Combine users and stats
        const usersWithStats = users.map((user, index) => ({
            ...user,
            ...userStats[index]
        }));

        // Sort by revenue (descending)
        usersWithStats.sort((a, b) => b.weeklyPackageRevenue - a.weeklyPackageRevenue);

        tbody.innerHTML = '';
        usersWithStats.forEach((user, index) => {
            console.log("Rendering user:", user);
            
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'even' : 'odd';

            const revenueText = `$${user.weeklyPackageRevenue.toFixed(2)}`; 
            const packageText = user.packageCount;

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
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        await renderMainClientChart(usersWithStats, dates);
        
        toggleViews('list');

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
    
    toggleViews('detail');
    
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    try {
        const dates = getDatesInRange(currentStartDate, currentEndDate);
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
            fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: user.id }),
            fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Emails", "created_date"], { user_id: user.id }),
            fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats", "created_date"], { user_id: user.id }),
            fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Number_Of_Calls", "created_date"], { user_id: user.id }),
            fetchData("Invoices_Pending", ["user_id", "paymentamount", "dateended"], { user_id: user.id })
        ]);

        const revenueByDay = {};
        daysOfWeek.forEach(day => {
            revenueByDay[day] = { packages: 0, emails: 0, chats: 0, calls: 0, invoices: 0 };
        });

        const weeklyPackageCost = packages.reduce((sum, pkg) => sum + (parseFloat(pkg.cost) || 0), 0);
        const dailyPackageCost = weeklyPackageCost / 7;
        daysOfWeek.forEach(day => {
            revenueByDay[day].packages = dailyPackageCost;
        });

        // Process email costs
        dailyEmailCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const emails = week[day].emails || 0;
                    const threshold = week[day].email_threshold || 0;
                    const overage = Math.max(0, emails - threshold);
                    const cost = overage * (week[day].email_cost_overage || 0);
                    revenueByDay[day].emails += cost;
                }
            });
        });

        // Process chat costs
        dailyChatCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const dailyCost = week[day].daily_cost || week[day].chats * (week[day].chat_per_conversation_cost || 0);
                    revenueByDay[day].chats += dailyCost || 0;
                }
            });
        });

        // Process call costs
        dailyCallsCosts.forEach(week => {
            daysOfWeek.forEach(day => {
                if (week[day] && typeof week[day] === 'object') {
                    const cost = week[day].cost || week[day].daily_cost || (week[day].minutes || 0) * (week[day].cost_per_minute || 0);
                    revenueByDay[day].calls += cost || 0;
                }
            });
        });

        // Process invoices
        invoices.forEach(invoice => {
            const amount = parseFloat(invoice.paymentamount) || 0;
            const date = new Date(invoice.dateended);
            const dayName = daysOfWeek[date.getDay()];
            if (revenueByDay[dayName]) {
                revenueByDay[dayName].invoices += amount / 7;
            }
        });

        const labels = daysOfWeek;
        const datasets = [
            {
                label: 'Packages',
                data: labels.map(day => parseFloat(revenueByDay[day].packages.toFixed(2))),
                backgroundColor: 'rgba(139, 92, 246, 0.8)'
            },
            {
                label: 'Emails',
                data: labels.map(day => parseFloat(revenueByDay[day].emails.toFixed(2))),
                backgroundColor: 'rgba(251, 191, 36, 0.8)'
            },
            {
                label: 'Chats',
                data: labels.map(day => parseFloat(revenueByDay[day].chats.toFixed(2))),
                backgroundColor: 'rgba(20, 184, 166, 0.8)'
            },
            {
                label: 'Calls',
                data: labels.map(day => parseFloat(revenueByDay[day].calls.toFixed(2))),
                backgroundColor: 'rgba(99, 102, 241, 0.8)'
            },
            {
                label: 'Invoices',
                data: labels.map(day => parseFloat(revenueByDay[day].invoices.toFixed(2))),
                backgroundColor: 'rgba(239, 68, 68, 0.8)'
            }
        ];

        const totals = {
            packages: datasets[0].data.reduce((sum, val) => sum + val, 0),
            emails: datasets[1].data.reduce((sum, val) => sum + val, 0),
            chats: datasets[2].data.reduce((sum, val) => sum + val, 0),
            calls: datasets[3].data.reduce((sum, val) => sum + val, 0),
            invoices: datasets[4].data.reduce((sum, val) => sum + val, 0)
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls + totals.invoices;

        document.getElementById('stat-packages').textContent = `$${totals.packages.toFixed(2)}`;
        document.getElementById('stat-emails').textContent = `$${totals.emails.toFixed(2)}`;
        document.getElementById('stat-chats').textContent = `$${totals.chats.toFixed(2)}`;
        document.getElementById('stat-calls').textContent = `$${totals.calls.toFixed(2)}`;
        document.getElementById('stat-invoices').textContent = `$${totals.invoices.toFixed(2)}`;
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
                        grid: { display: false }
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
                            footer: function(tooltipItems) {
                                let total = 0;
                                tooltipItems.forEach(item => {
                                    total += item.parsed.y;
                                });
                                return 'Total: $' + total.toFixed(2);
                            },
                            label: function(context) {
                                return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                            }
                        }
                    },
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });

        if (packages.length > 0) {
            const packagesCard = document.getElementById('packages-card');
            const packagesGrid = document.getElementById('packages-grid');
            
            packagesGrid.innerHTML = '';
            packages.forEach(pkg => {
                const pkgDiv = document.createElement('div');
                pkgDiv.className = 'package-item';
                
                pkgDiv.innerHTML = `
                    <div class="package-header">
                        <h4>${pkg.name}</h4>
                        <span class="package-badge">${pkg.frequency}</span>
                    </div>
                    <p class="package-cost">$${parseFloat(pkg.cost).toFixed(2)}</p>
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

// SECTION: Initialization and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById("start-date");
    const endDateInput = document.getElementById("end-date");
    const loadButton = document.getElementById("load-users");
    
    // Set default dates
    const today = new Date();
    const lastSunday = getLastSunday();
    
    currentEndDate = formatDate(today);
    currentStartDate = formatDate(lastSunday);
    
    startDateInput.value = currentStartDate;
    endDateInput.value = currentEndDate;
    
    // Date change handlers
    startDateInput.addEventListener('change', (e) => {
        currentStartDate = e.target.value;
    });
    
    endDateInput.addEventListener('change', (e) => {
        currentEndDate = e.target.value;
    });
    
    // Load button handler
    loadButton.addEventListener('click', () => {
        loadUsers();
    });
    
    // Back Button Handler
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            toggleViews('list');
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
        });
    }

    // Initialize the dashboard
    loadUsers();
});
//!SECTION