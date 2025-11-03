//app.js 
// // SECTION: Global variables
const API_ENDPOINT = "https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb";
let chartInstance = null;
let currentUser = null;
//!SECTION

// SECTION: Fetch function
async function fetchData(tableName, columns, filters = {}, options={}) { //TODO: add dates
    console.log(`Fetching data from table: ${tableName} with filters:`, filters);
    const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_name: tableName, columns, filters })
    });

    const contentType = response.headers.get("content-type");
    let result;
    console.log("Response content type:", contentType);
    console.log("Raw response:", response);
    
    if (contentType && contentType.includes("application/json")) {
        result = await response.json();
    } else {
        const text = await response.text();
        try {
            result = JSON.parse(text);
        } catch (e) {
            result = text;
        }
    }
    console.log(`Data fetched from table: ${tableName}`, result);

    if (Array.isArray(result)) return result;
    if (result && typeof result === "object") {
        return result.rows || result.data || result.result || [];
    }
    console.error("No data found in response for table:", tableName);
    return [];
} //!SECTION

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
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">No users found.</td></tr>';
            console.warn("No users found.");
            return;
        }

        tbody.innerHTML = '';
        users.forEach((user, index) => {
            console.log("Rendering user:", user);
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'even' : 'odd';
            tr.innerHTML = `
                <td>${user.id}</td>
                <td>${user.first_name}</td>
                <td>${user.last_name}</td>
                <td>${user.email}</td>
            `;
            tr.addEventListener('click', () => showUserDetail(user));
            tbody.appendChild(tr);
        });

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="error">Error loading users: ${error.message}</td></tr>`;
        console.error("Error loading users:", error);
    }
} //!SECTION

// SECTION: User detail
async function showUserDetail(user) {
    console.log("Showing details for user:", user);
    currentUser = user;
    
    // Switch views
    //document.getElementById('user-list-view').style.display = 'none';
    document.getElementById('user-detail-view').style.display = 'block';
    
    // Update header
    document.getElementById('user-detail-title').textContent = 
        `Revenue Breakdown: ${user.first_name} ${user.last_name}`;
    document.getElementById('user-detail-subtitle').textContent = `User ID: ${user.id}`;
    
    // Show loading state
    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '$0.00');
    
    try {
        // Fetch all revenue data sources
        const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
            fetchData("manual_charges", ["user_id", "frequency", "cost"], { user_id: user.id }),
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

// // SECTION: Back button handler
// document.getElementById('back-button').addEventListener('click', () => {
//     document.getElementById('user-list-view').style.display = 'block';
//     document.getElementById('user-detail-view').style.display = 'none';
    
//     if (chartInstance) {
//         chartInstance.destroy();
//         chartInstance = null;
//     }
    
//     currentUser = null;
// });

// //!SECTION


// // SECTION: Intitialize
//TODO - Set dates and add listeners if they change:
//SECTION - end date
document.addEventListener('DOMContentLoaded', (event) => {
       const dateInput = document.getElementById('end-date');
       const today = new Date();

       // Format the date as YYYY-MM-DD for the input type="date"
       const year = today.getFullYear();
       const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
       const day = String(today.getDate()).padStart(2, '0');

       const formattedDate = `${year}-${month}-${day}`;
       dateInput.value = formattedDate;
   }); //!SECTION
//SECTION - Start Date
document.addEventListener('DOMContentLoaded', (event) => {
       const dateInput = document.getElementById('start-date');
       const today = new Date();
       const lastweek = new Date(today);
       lastweek.setDate(today.getDate()-7);

       // Format the date as YYYY-MM-DD for the input type="date"
       const year = lastweek.getFullYear();
       const month = String(lastweek.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
       const day = String(lastweek.getDate()).padStart(2, '0');

       const formattedDate = `${year}-${month}-${day}`;
       dateInput.value = formattedDate;
   });//!SECTION
loadUsers();
// //!SECTION

//