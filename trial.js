const API_ENDPOINT = "https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb";
let chartInstance = null;

// Generic fetch function
async function fetchData(tableName, columns, filters = {}) {
    const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_name: tableName, columns, filters })
    });

    const contentType = response.headers.get("content-type");
    let result;
    
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

    if (Array.isArray(result)) return result;
    if (result && typeof result === "object") {
        return result.rows || result.data || result.result || [];
    }
    return [];
}

// Load users table
async function loadUsers() {
    const container = document.getElementById('user-list');
    container.innerHTML = '<p>Loading users...</p>';

    try {
        const users = await fetchData("users", 
            ["id", "first_name", "last_name", "email"],
            { is_admin: "0" }
        );

        if (users.length === 0) {
            container.innerHTML = '<p>No users found.</p>';
            return;
        }

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="border: 1px solid #ddd; padding: 8px;">ID</th>
                    <th style="border: 1px solid #ddd; padding: 8px;">First Name</th>
                    <th style="border: 1px solid #ddd; padding: 8px;">Last Name</th>
                    <th style="border: 1px solid #ddd; padding: 8px;">Email</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');
        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = `
                <td style="border: 1px solid #ddd; padding: 8px;">${user.id}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${user.first_name}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${user.last_name}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${user.email}</td>
            `;
            tr.addEventListener('mouseover', () => tr.style.backgroundColor = '#f0f0f0');
            tr.addEventListener('mouseout', () => tr.style.backgroundColor = '');
            tr.addEventListener('click', () => showUserChart(user));
            tbody.appendChild(tr);
        });

        container.innerHTML = '';
        container.appendChild(table);

    } catch (error) {
        container.innerHTML = `<p style="color: red;">Error loading users: ${error.message}</p>`;
        console.error("Error loading users:", error);
    }
}

// Show revenue chart for a user
async function showUserChart(user) {
    const userListEl = document.getElementById('user-list');
    const chartContainer = document.getElementById('chart-container');
    const chartTitle = document.getElementById('chart-title');

    userListEl.style.display = 'none';
    chartContainer.style.display = 'block';
    chartTitle.textContent = `Revenue Breakdown: ${user.first_name} ${user.last_name} (ID: ${user.id})`;

    try {
        // Fetch all revenue data sources
        const [packages, dailyEmailCosts, dailyChatCosts, dailyCallsCosts, invoices] = await Promise.all([
            fetchData("manual_charges", ["user_id", "frequency", "cost", "name"], { user_id: user.id }),
            fetchData("Daily_Email_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost"], { user_id: user.id }),
            fetchData("Daily_Chat_Record_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost"], { user_id: user.id }),
            fetchData("Daily_Calls_Cost_Record", ["user_id", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Week_Cost"], { user_id: user.id }),
            fetchData("Invoices_Pending", ["user_id", "paymentamount", "dateended"], { user_id: user.id })
        ]);

        // Process data by day
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
                    // Email cost calculation: if over threshold, charge overage
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
                    const cost = week[day].cost || week[day].daily_cost || 0;
                    revenueByDay[day].calls += cost || 0;
                }
            });
        });

        // Process invoices (distribute by date)
        invoices.forEach(invoice => {
            const amount = parseFloat(invoice.paymentamount) || 0;
            const date = new Date(invoice.dateended);
            const dayName = daysOfWeek[date.getDay()];
            if (revenueByDay[dayName]) {
                revenueByDay[dayName].invoices += amount / 7; // Simplified distribution
            }
        });

        // Prepare chart data
        const labels = daysOfWeek;
        const datasets = [
            {
                label: 'Packages',
                data: labels.map(day => revenueByDay[day].packages),
                backgroundColor: 'rgba(54, 162, 235, 0.8)'
                /*TODO: add colors from root*/
            },
            {
                label: 'Emails',
                data: labels.map(day => revenueByDay[day].emails),
                backgroundColor: 'rgba(255, 206, 86, 0.8)'
                /*TODO: add colors from root*/
            },
            {
                label: 'Chats',
                data: labels.map(day => revenueByDay[day].chats),
                backgroundColor: 'rgba(75, 192, 192, 0.8)'
                /*TODO: add colors from root*/
            },
            {
                label: 'Calls',
                data: labels.map(day => revenueByDay[day].calls),
                backgroundColor: 'rgba(153, 102, 255, 0.8)'
                /*TODO: add colors from root*/
            },
            {
                label: 'Invoices',
                data: labels.map(day => revenueByDay[day].invoices),
                backgroundColor: 'rgba(255, 99, 132, 0.8)'
                /*TODO: add colors from root*/
            }
        ];

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
                scales: {
                    x: {
                        stacked: true,
                        title: {
                            display: true,
                            text: 'Day of Week'
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Revenue ($)'
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Daily Revenue by Source'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            footer: function(tooltipItems) {
                                let total = 0;
                                tooltipItems.forEach(item => {
                                    total += item.parsed.y;
                                });
                                return 'Total: $' + total.toFixed(2);
                            }
                        }
                    }
                }
            }
        });

    } catch (error) {
        chartTitle.textContent = `Error loading chart: ${error.message}`;
        console.error("Error loading chart:", error);
    }
}

// Back button handler
document.getElementById('back-button').addEventListener('click', () => {
    document.getElementById('user-list').style.display = 'block';
    document.getElementById('chart-container').style.display = 'none';
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
});

// Initialize
loadUsers();