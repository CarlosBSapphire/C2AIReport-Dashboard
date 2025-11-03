//app.js 
// // SECTION: Global variables
const API_ENDPOINT = "https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb";
let chartInstance = null; // For user detail chart
let mainChartInstance = null; // NEW: For main page chart
let currentUser = null;
const listElements = ['userform', 'users-table', 'main-client-chart']; // Elements visible in the list view
//!SECTION

// SECTION: Fetch function
async function fetchData(tableName, columns, filters = {}, options={}) { //TODO: add dates
    console.log(`Fetching data from table: ${tableName} with filters:`, filters);
    const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_name: tableName, columns, filters })
    });

    // Check for HTTP errors (e.g., 404, 500)
    if (!response.ok) {
        console.error(`HTTP Error for ${tableName}: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch ${tableName} data: ${response.statusText}`);
    }

    // Always get the response as text for robust handling of empty/malformed JSON
    const text = await response.text();
    
    // Check if the response body is empty or consists only of whitespace
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
        // If it fails to parse, return an empty array to prevent failure in Promise.all
        return []; 
    }
    
    if (Array.isArray(result)) return result;
    if (result && typeof result === "object") {
        return result.rows || result.data || result.result || [];
    }
    console.error("No data found in expected format for table:", tableName);
    return [];
} //!SECTION

// SECTION: Helper function to get package stats
async function getPackageStatsForUser(userId) {
    // This call is now robust against empty JSON responses
    const packages = await fetchData("manual_charges", ["user_id", "cost"], { user_id: userId });
    const packageCount = packages.length;
    // Calculate total weekly cost from all packages
    const weeklyPackageRevenue = packages.reduce((sum, pkg) => {
        return sum + (parseFloat(pkg.cost) || 0);
    }, 0);
    return { packageCount, weeklyPackageRevenue };
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
    } else { // 'list' view
        userDetailView.style.display = 'none';
        listElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = ''; // Restore default display
        });
    }
}
//!SECTION

// SECTION: Main Chart Rendering
function renderMainClientChart(usersWithStats) {
    const ctx = document.getElementById('main-revenue-chart').getContext('2d');
    
    if (mainChartInstance) {
        mainChartInstance.destroy();
    }

    // Sort by revenue for better visualization
    const sortedUsers = [...usersWithStats].sort((a, b) => b.weeklyPackageRevenue - a.weeklyPackageRevenue);

    const labels = sortedUsers.map(u => `${u.first_name} ${u.last_name}`);
    const data = sortedUsers.map(u => parseFloat(u.weeklyPackageRevenue.toFixed(2)));

    mainChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Weekly Package Revenue ($)',
                data: data,
                backgroundColor: 'rgba(139, 92, 246, 0.8)', // Primary package color
                borderColor: 'rgba(139, 92, 246, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y', // Horizontal bars for client names
            scales: {
                x: {
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
                    text: 'Total Weekly Package Revenue by Client'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.parsed.x.toFixed(2);
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
                <td>${revenueText}</td> <td>${packageText}</td> `;
            tr.addEventListener('click', () => showUserDetail(user));
            tbody.appendChild(tr);
        });
        
        // Render the main chart
        renderMainClientChart(usersWithStats);
        
        // Ensure initial view is 'list'
        toggleViews('list');

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="error">Error loading users: ${error.message}</td></tr>`;
        console.error("Error loading users:", error);
    }
} //!SECTION

// SECTION: User detail
async function showUserDetail(user) {
    console.log("Showing details for user:", user);
    currentUser = user;
    
    // NEW: Switch to detail view
    toggleViews('detail');
    
    // Update header
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    // Show loading state
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    try {
        // Fetch all revenue data sources (NOW INCLUDING 'name' IN manual_charges)
        const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
            fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: user.id }), // Re-added 'name' for package cards
            fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost","Total_Emails"], { user_id: user.id }),
            fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost", "Total_Chats"], { user_id: user.id }),
            fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost","Number_Of_Calls"], { user_id: user.id }),
            fetchData("Invoices_Pending", ["user_id", "paymentamount", "dateended"], { user_id: user.id })
        ]);

        // Process data by day
        //TODO: Change this to update by date
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const revenueByDay = {};

        // Initialize structure
        daysOfWeek.forEach(day => {
            revenueByDay[day] = {
                packages: 0,
                emails: 0,
                chats: 0,
                calls: 0,
                invoices: 0
            };
        });

        // Calculate weekly package costs (distributed across all days)
        const weeklyPackageCost = packages.reduce((sum, pkg) => {
            return sum + (parseFloat(pkg.cost) || 0);
        }, 0);
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

        // Process invoices (simplified distribution)
        invoices.forEach(invoice => {
            const amount = parseFloat(invoice.paymentamount) || 0;
            const date = new Date(invoice.dateended);
            const dayName = daysOfWeek[date.getDay()];
            if (revenueByDay[dayName]) {
                revenueByDay[dayName].invoices += amount / 7;
            }
        });

        // Prepare chart data
        const labels = daysOfWeek;
        const datasets = [
            {
                label: 'Packages',
                data: labels.map(day => parseFloat(revenueByDay[day].packages.toFixed(2))),
                backgroundColor: 'rgba(139, 92, 246, 0.8)' //TODO: Change colors
            },
            {
                label: 'Emails',
                data: labels.map(day => parseFloat(revenueByDay[day].emails.toFixed(2))),
                backgroundColor: 'rgba(251, 191, 36, 0.8)' //TODO: Change colors
            },
            {
                label: 'Chats',
                data: labels.map(day => parseFloat(revenueByDay[day].chats.toFixed(2))),
                backgroundColor: 'rgba(20, 184, 166, 0.8)' //TODO: Change colors
            },
            {
                label: 'Calls',
                data: labels.map(day => parseFloat(revenueByDay[day].calls.toFixed(2))),
                backgroundColor: 'rgba(99, 102, 241, 0.8)' //TODO: Change colors
            },
            {
                label: 'Invoices',
                data: labels.map(day => parseFloat(revenueByDay[day].invoices.toFixed(2))),
                backgroundColor: 'rgba(239, 68, 68, 0.8)'//TODO: Change colors
            }
        ];

        // Calculate totals
        const totals = {
            packages: datasets[0].data.reduce((sum, val) => sum + val, 0),
            emails: datasets[1].data.reduce((sum, val) => sum + val, 0),
            chats: datasets[2].data.reduce((sum, val) => sum + val, 0),
            calls: datasets[3].data.reduce((sum, val) => sum + val, 0),
            invoices: datasets[4].data.reduce((sum, val) => sum + val, 0)
        };
        totals.total = totals.packages + totals.emails + totals.chats + totals.calls + totals.invoices;

        // Update stat cards
        document.getElementById('stat-packages').textContent = `$${totals.packages.toFixed(2)}`;
        document.getElementById('stat-emails').textContent = `$${totals.emails.toFixed(2)}`;
        document.getElementById('stat-chats').textContent = `$${totals.chats.toFixed(2)}`;
        document.getElementById('stat-calls').textContent = `$${totals.calls.toFixed(2)}`;
        document.getElementById('stat-invoices').textContent = `$${totals.invoices.toFixed(2)}`;
        document.getElementById('stat-total').textContent = `$${totals.total.toFixed(2)}`;

        // Create chart
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
                        grid: {
                            display: false
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

        // Display packages
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
}//!SECTION

// SECTION: Initialization and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Back Button Handler
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            toggleViews('list');
            if (chartInstance) { // Destroy detail chart
                chartInstance.destroy();
                chartInstance = null;
            }
        });
    }

    // Initialize the dashboard
    loadUsers();
});
//!SECTION

//