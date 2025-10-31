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
                <td>${user.id}</td>
                <td>${user.first_name}</td>
                <td>${user.last_name}</td>
                <td>${user.email}</td>
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
            },
            {
                label: 'Emails',
                data: labels.map(day => revenueByDay[day].emails),
                backgroundColor: 'rgba(255, 206, 86, 0.8)'
            },
            {
                label: 'Chats',
                data: labels.map(day => revenueByDay[day].chats),
                backgroundColor: 'rgba(75, 192, 192, 0.8)'
            },
            {
                label: 'Calls',
                data: labels.map(day => revenueByDay[day].calls),
                backgroundColor: 'rgba(153, 102, 255, 0.8)'
            },
            {
                label: 'Invoices',
                data: labels.map(day => revenueByDay[day].invoices),
                backgroundColor: 'rgba(255, 99, 132, 0.8)'
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

<<<<<<< HEAD
// Initialize
loadUsers();
=======
	const table = document.createElement("table");
	table.className = "data-table";
	// NOTE: Allow CSS hooks?

	const thead = document.createElement("thead");
	const tbody = document.createElement("tbody");

	// Parse incoming 'data' which may be a JSON string or object
	let parsedData = null;
	try {
		parsedData = (typeof data === 'string') ? JSON.parse(data) : data;
	} catch (e) {
		console.warn("createTable: could not parse data as JSON, treating as empty columns", e);
		parsedData = {};
	}

	const columns = Array.isArray(parsedData.columns) ? parsedData.columns : [];

	// Create table headers from columns array
	const headerRow = document.createElement("tr");
	if (columns.length === 0) {
		const th = document.createElement("th");
		th.textContent = "No columns";
		headerRow.appendChild(th);
	} else {
		columns.forEach((col) => {
			const th = document.createElement("th");
			th.textContent = col;
			headerRow.appendChild(th);
		});
	}
	thead.appendChild(headerRow);
	table.appendChild(thead);

	// Attach tbody with a predictable id so we can populate later
	const tbodyId = `${tableId}-tbody`;
	tbody.id = tbodyId;
	table.appendChild(tbody);

	// Save columns on table for populateRows to read
	try {
		table.dataset.columns = JSON.stringify(columns);
	} catch (e) {
		table.dataset.columns = "[]";
	}

	container.appendChild(table);
	console.log("Table headers created:", tableId, "columns:", columns);

	
}

/* Populate table rows for a given tableId from an array of row objects/arrays */
function populateRows(tableId, rows) {
	const tbody = document.getElementById(`${tableId}-tbody`);
	if (!tbody) {
		console.error("populateRows: tbody not found for", tableId);
		return;
	}

	// Find the table and columns metadata
	const table = tbody.closest('table');
	let columns = [];
	try {
		columns = table && table.dataset && table.dataset.columns ? JSON.parse(table.dataset.columns) : [];
	} catch (e) {
		columns = [];
	}

	// Clear existing rows
	tbody.innerHTML = '';

	if (!rows || rows.length === 0) {
		const tr = document.createElement('tr');
		const td = document.createElement('td');
		td.colSpan = Math.max(1, columns.length);
		td.textContent = 'No data';
		tr.appendChild(td);
		tbody.appendChild(tr);
		return;
	}

	rows.forEach((row) => {
		const tr = document.createElement('tr');

		if (columns.length > 0) {
			// Respect column order
			columns.forEach((col) => {
				const td = document.createElement('td');
				let val = '';
				if (row && typeof row === 'object') {
					// row might be object with keys
					if (col in row) val = row[col];
					else if (Array.isArray(row)) val = row.shift();
				} else {
					val = row;
				}
				td.textContent = val === null || val === undefined ? '' : String(val);
				tr.appendChild(td);
			});
		} else {
			// No columns defined: render object values in order
			if (row && typeof row === 'object') {
				Object.values(row).forEach((v) => {
					const td = document.createElement('td');
					td.textContent = v === null || v === undefined ? '' : String(v);
					tr.appendChild(td);
				});
			} else {
				const td = document.createElement('td');
				td.textContent = row === null || row === undefined ? '' : String(row);
				tr.appendChild(td);
				
			}
		}

		tbody.appendChild(tr);
	});
	}

/* Pull for individual table */
function pullClientTable(userId) {
	/*TODO: pull requests for all the data*/
	console.log("Pulling data for user ID:", userId);
	/*TODO: fetch the daily email costs */
	dailyEmailCosts = fetchDailyEmailCosts(userId);


	/*TODO: Create the table*/

	/*createTable(raw,'client-indiviual-table');*/

}

function calculateMoneyMade(userId) {
	res=0;
	//Add packages
	packageData = fetchPackages(userId);
	for (let pkg of packageData) {
		if (pkg.frequency === "weekly") {
			res+= pkg.cost; //NOTE - until I figure out weekly monthly bs
		}
	}

	//add daily email costs
	dailyEmailData = fetchDailyEmailCosts(userId);
	// Daily emails have a new enrty for each week. 
	
}

/* -------------- Data Fetchers ------------- */

/* Fetch Daily Email Costs 
 sample response:
 [
    {
        "user_id": 80,
        "Sunday": {
            "emails": 28,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Monday": {
            "emails": 45,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Tuesday": {
            "emails": 38,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Wednesday": {
            "emails": 28,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Thursday": {
            "emails": 37,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Friday": {
            "emails": 24,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Saturday": {
            "emails": 17,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Week_Cost": "0.00",
        "Total_Emails": 217
    },
    {
        "user_id": 80,
        "Sunday": {
            "emails": 11,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Monday": {
            "emails": 17,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Tuesday": {
            "emails": 26,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Wednesday": {
            "emails": 25,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Thursday": {
            "emails": 16,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Friday": {
            "emails": 19,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Saturday": {
            "emails": 12,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Week_Cost": "0.00",
        "Total_Emails": 126
    },
    {
        "user_id": 80,
        "Sunday": {
            "emails": 26,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Monday": null,
        "Tuesday": {
            "emails": 10,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Wednesday": {
            "emails": 56,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Thursday": {
            "emails": 25,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Friday": {
            "emails": 59,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Saturday": {
            "emails": 38,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Week_Cost": "0.00",
        "Total_Emails": 214
    },
    {
        "user_id": 80,
        "Sunday": {
            "emails": 15,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Monday": {
            "emails": 32,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Tuesday": {
            "emails": 21,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Wednesday": {
            "emails": 22,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Thursday": {
            "emails": 30,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Friday": {
            "emails": 15,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Saturday": {
            "emails": 9,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Week_Cost": "0.00",
        "Total_Emails": 144
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": {
            "emails": 8,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Tuesday": {
            "emails": 9,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Wednesday": {
            "emails": 8,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Thursday": {
            "emails": 22,
            "email_threshold": 250,
            "email_cost_overage": 0.1
        },
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.00",
        "Total_Emails": 47
    }
]*/
function fetchDailyEmailCosts(userId) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
		"table_name": "Daily_Email_Cost_Record",
		"columns": [
			"user_id",
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
			"Week_Cost",
			"Total_Emails"
		],
		"filters": {
			"user_id": userId
		}
		});

	const requestOptions = {
		method: "POST",
		headers: myHeaders,
		body: raw,
		redirect: "follow"
		};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
		.then((response) => response.text())
		.then((result) => console.log(result))
		.catch((error) => console.error(error));
	console.log("Fetch request  for Daily Email costs sent.");
	console.log(raw);
	return raw;
}

/* Fetch Packages 
sample response:
[
    {
        "user_id": 1,
        "frequency": "Weekly",
        "cost": "50.00",
        "name": "Inbound Calls"
    },
    {
        "user_id": 1,
        "frequency": "Weekly",
        "cost": "25.00",
        "name": "One Time Charge"
    },
    {
        "user_id": 1,
        "frequency": "Weekly",
        "cost": "1.00",
        "name": "Phone Numbers"
    },
    {
        "user_id": 1,
        "frequency": "Weekly",
        "cost": "25.00",
        "name": "Email Agents"
    }
]
*/
function fetchPackages(userId) {
	const myHeaders = new Headers();
myHeaders.append("Content-Type", "application/json");

const raw = JSON.stringify({
	"table_name": "manual_charges",
	"columns": [
		"user_id",
		"frequency",
		"cost",
		"name"
	],
	"filters": {
		"user_id": userId
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}


/* Fetch AI Email Records */
/*sample response:
[
    {
        "user_id": "80",
        "duration": 489
    },
    {
        "user_id": "80",
        "duration": 70
    },
    {
        "user_id": "80",
        "duration": 375
    },
    {
        "user_id": "80",
        "duration": 95
    },
    {
        "user_id": "80",
        "duration": 73
    },
    {
        "user_id": "80",
        "duration": 89
    },
    {
        "user_id": "80",
        "duration": 389
    },
    {
        "user_id": "80",
        "duration": 122
    },
    {
        "user_id": "80",
        "duration": 30
    },
    {
        "user_id": "80",
        "duration": 249
    },
    {
        "user_id": "80",
        "duration": 85
    },
    {
        "user_id": "80",
        "duration": 229
    },
    {
        "user_id": "80",
        "duration": 102
    },
    {
        "user_id": "80",
        "duration": 57
    },
    {
        "user_id": "80",
        "duration": 406
    },
    {
        "user_id": "80",
        "duration": 778
    },
    {
        "user_id": "80",
        "duration": 450
    },
    {
        "user_id": "80",
        "duration": 353
    },
    {
        "user_id": "80",
        "duration": 166
    },
    {
        "user_id": "80",
        "duration": 133
    },
    {
        "user_id": "80",
        "duration": 160
    },
    {
        "user_id": "80",
        "duration": 231
    },
    {
        "user_id": "80",
        "duration": 72
    },
    {
        "user_id": "80",
        "duration": 64
    },
    {
        "user_id": "80",
        "duration": 262
    },
    {
        "user_id": "80",
        "duration": 141
    },
    {
        "user_id": "80",
        "duration": 206
    },
    {
        "user_id": "80",
        "duration": 90
    },
    {
        "user_id": "80",
        "duration": 200
    },
    {
        "user_id": "80",
        "duration": 327
    },
    {
        "user_id": "80",
        "duration": 164
    },
    {
        "user_id": "80",
        "duration": 100
    },
    {
        "user_id": "80",
        "duration": 298
    },
    {
        "user_id": "80",
        "duration": 186
    },
    {
        "user_id": "80",
        "duration": 615
    },
    {
        "user_id": "80",
        "duration": 210
    },
    {
        "user_id": "80",
        "duration": 288
    },
    {
        "user_id": "80",
        "duration": 63
    },
    {
        "user_id": "80",
        "duration": 152
    },
    {
        "user_id": "80",
        "duration": 136
    },
    {
        "user_id": "80",
        "duration": 161
    },
    {
        "user_id": "80",
        "duration": 169
    },
    {
        "user_id": "80",
        "duration": 155
    },
    {
        "user_id": "80",
        "duration": 77
    },
    {
        "user_id": "80",
        "duration": 204
    },
    {
        "user_id": "80",
        "duration": 112
    },
    {
        "user_id": "80",
        "duration": 678
    },
    {
        "user_id": "80",
        "duration": 39
    },
    {
        "user_id": "80",
        "duration": 249
    },
    {
        "user_id": "80",
        "duration": 164
    }
]*/
function fetchAIEmailRecords(userId) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
	"table_name": "Call_Data",
	"columns": [
		"user_id",
		"duration"
	],
	"filters": {
		"user_id": userId
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}

/* Fetch Invoices Pending */
/* sample response:
[
    {
        "user_id": 80,
        "paymentamount": "169.28",
        "dateended": "2025-07-27"
    },
    {
        "user_id": 80,
        "paymentamount": "433.66",
        "dateended": "2025-08-03"
    },
    {
        "user_id": 80,
        "paymentamount": "205.58",
        "dateended": "2025-08-10"
    },
    {
        "user_id": 80,
        "paymentamount": "494.13",
        "dateended": "2025-08-17"
    },
    {
        "user_id": 80,
        "paymentamount": "253.67",
        "dateended": "2025-08-24"
    },
    {
        "user_id": 80,
        "paymentamount": "282.74",
        "dateended": "2025-08-31"
    },
    {
        "user_id": 80,
        "paymentamount": "212.92",
        "dateended": "2025-09-07"
    },
    {
        "user_id": 80,
        "paymentamount": "238.72",
        "dateended": "2025-09-14"
    },
    {
        "user_id": 80,
        "paymentamount": "438.80",
        "dateended": "2025-09-21"
    },
    {
        "user_id": 80,
        "paymentamount": "420.01",
        "dateended": "2025-09-28"
    },
    {
        "user_id": 80,
        "paymentamount": "127.31",
        "dateended": "2025-10-05"
    },
    {
        "user_id": 80,
        "paymentamount": "245.53",
        "dateended": "2025-10-12"
    },
    {
        "user_id": 80,
        "paymentamount": "223.16",
        "dateended": "2025-10-11"
    },
    {
        "user_id": 80,
        "paymentamount": "303.03",
        "dateended": "2025-10-18"
    },
    {
        "user_id": 80,
        "paymentamount": "414.87",
        "dateended": "2025-10-25"
    },
    {
        "user_id": 80,
        "paymentamount": "293.12",
        "dateended": "2025-11-01"
    }
]*/
function fetchInvoicesPending(userId) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
	"table_name": "Invoices_Pending",
	"columns": [
		"user_id",
		"paymentamount",
		"dateended"
	],
	"filters": {
		"user_id": userId
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}

/* Fetch AI chat data */
/* sample response: 
[
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    },
    {
        "user_id": "80"
    }
]*/
function fetchAIChatData(userId) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
	"table_name": "AI_Chat_Data",
	"columns": [
		"user_id"
	],
	"filters": {
		"user_id": 80
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}

/* Fetch  Chat record costs */
/* sample response:
[
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": {
            "chats": 13,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Thursday": null,
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.26",
        "Total_Chats": 13,
        "Week_Cost_Overage_Cost": "0.00"
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": {
            "daily_cost": 0.11,
            "total_chats": 11,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Thursday": {
            "daily_cost": 0.15,
            "total_chats": 15,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Friday": {
            "daily_cost": 0.12,
            "total_chats": 12,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Saturday": null,
        "Week_Cost": "0.00",
        "Total_Chats": 0,
        "Week_Cost_Overage_Cost": "0.00"
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": {
            "daily_cost": 0.17,
            "total_chats": 17,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Tuesday": {
            "daily_cost": 0.22,
            "total_chats": 22,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Wednesday": {
            "daily_cost": 0.13,
            "total_chats": 13,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Thursday": {
            "daily_cost": 0.19,
            "total_chats": 19,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Friday": {
            "daily_cost": 0.06,
            "total_chats": 6,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Saturday": {
            "daily_cost": 0.09,
            "total_chats": 9,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Week_Cost": "0.00",
        "Total_Chats": 0,
        "Week_Cost_Overage_Cost": "0.00"
    },
    {
        "user_id": 80,
        "Sunday": {
            "daily_cost": 0.01,
            "total_chats": 1,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Monday": {
            "daily_cost": 0.14,
            "total_chats": 14,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Tuesday": {
            "daily_cost": 0.07,
            "total_chats": 7,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Wednesday": {
            "daily_cost": 0.13,
            "total_chats": 13,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Thursday": {
            "daily_cost": 0.05,
            "total_chats": 5,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "daily_overage_cost": 0,
            "chat_per_conversation_cost": 0.01
        },
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.00",
        "Total_Chats": 0,
        "Week_Cost_Overage_Cost": "0.00"
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": {
            "chats": 5,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.10",
        "Total_Chats": 5,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": null,
        "Friday": {
            "chats": 23,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Saturday": null,
        "Week_Cost": "0.46",
        "Total_Chats": 23,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": null,
        "Friday": null,
        "Saturday": {
            "chats": 13,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Week_Cost": "0.26",
        "Total_Chats": 13,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": {
            "chats": 16,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Monday": null,
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": null,
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.32",
        "Total_Chats": 16,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": {
            "chats": 11,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": null,
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.22",
        "Total_Chats": 11,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": {
            "chats": 1,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Wednesday": null,
        "Thursday": null,
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.02",
        "Total_Chats": 1,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": {
            "chats": 4,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Thursday": null,
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.08",
        "Total_Chats": 4,
        "Week_Cost_Overage_Cost": null
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": {
            "chats": 11,
            "chat_threshold": 0,
            "chat_cost_overage": 0.01,
            "chat_per_conversation_cost": 0.01
        },
        "Friday": null,
        "Saturday": null,
        "Week_Cost": "0.22",
        "Total_Chats": 11,
        "Week_Cost_Overage_Cost": null
    }
]*/
function fetchChatRecordCosts(userId) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
	"table_name": "Daily_Chat_Record_Cost_Record",
	"columns": [
		"user_id",
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
		"Week_Cost",
		"Total_Chats",
		"Week_Cost_Overage_Cost"
	],
	"filters": {
		"user_id": userId
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}

/*Calls Cost REcords*/
/* sample response: 
[
    {
        "user_id": 80,
        "Sunday": {
            "minutes": 30.2,
            "daily_cost": null,
            "total_calls": 7,
            "overage_calls": 0,
            "total_inbound": 7,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Monday": {
            "minutes": 148.95,
            "daily_cost": null,
            "total_calls": 38,
            "overage_calls": 0,
            "total_inbound": 38,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Tuesday": {
            "minutes": 88.1,
            "daily_cost": null,
            "total_calls": 30,
            "overage_calls": 0,
            "total_inbound": 30,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Wednesday": {
            "minutes": 107.3833,
            "daily_cost": null,
            "total_calls": 29,
            "overage_calls": 0,
            "total_inbound": 29,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Thursday": {
            "minutes": 69.05,
            "daily_cost": null,
            "total_calls": 31,
            "overage_calls": 0,
            "total_inbound": 31,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Friday": {
            "minutes": 92,
            "daily_cost": null,
            "total_calls": 25,
            "overage_calls": 0,
            "total_inbound": 25,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Saturday": {
            "minutes": 20.4833,
            "daily_cost": null,
            "total_calls": 8,
            "overage_calls": 0,
            "total_inbound": 8,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Week_Cost": "0.00",
        "Number_Of_Calls": 168
    },
    {
        "user_id": 80,
        "Sunday": {
            "minutes": 31.2667,
            "daily_cost": null,
            "total_calls": 9,
            "overage_calls": 0,
            "total_inbound": 9,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Monday": {
            "minutes": 74.7333,
            "daily_cost": null,
            "total_calls": 24,
            "overage_calls": 0,
            "total_inbound": 24,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Tuesday": {
            "minutes": 82.8833,
            "daily_cost": null,
            "total_calls": 23,
            "overage_calls": 0,
            "total_inbound": 23,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Wednesday": {
            "minutes": 79.2667,
            "daily_cost": null,
            "total_calls": 30,
            "overage_calls": 0,
            "total_inbound": 30,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Thursday": {
            "minutes": 76.3667,
            "daily_cost": null,
            "total_calls": 28,
            "overage_calls": 0,
            "total_inbound": 28,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Friday": {
            "minutes": 63.8833,
            "daily_cost": null,
            "total_calls": 18,
            "overage_calls": 0,
            "total_inbound": 18,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Saturday": {
            "minutes": 18.7333,
            "daily_cost": null,
            "total_calls": 7,
            "overage_calls": 0,
            "total_inbound": 7,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Week_Cost": "0.00",
        "Number_Of_Calls": 139
    },
    {
        "user_id": 80,
        "Sunday": {
            "minutes": 14.1167,
            "daily_cost": null,
            "total_calls": 4,
            "overage_calls": 0,
            "total_inbound": 4,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Monday": {
            "minutes": 86.9833,
            "daily_cost": null,
            "total_calls": 22,
            "overage_calls": 0,
            "total_inbound": 22,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Tuesday": {
            "minutes": 133.2833,
            "daily_cost": null,
            "total_calls": 24,
            "overage_calls": 0,
            "total_inbound": 24,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Wednesday": {
            "minutes": 74.4167,
            "daily_cost": null,
            "total_calls": 20,
            "overage_calls": 0,
            "total_inbound": 20,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Thursday": {
            "minutes": 66.9333,
            "daily_cost": 23.426655,
            "total_calls": 20,
            "overage_calls": 0,
            "total_inbound": 20,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": 0.35,
            "daily_overage_cost": 0,
            "over_threshold_active": 0,
            "phone_per_minute_overage": 0.35
        },
        "Friday": {
            "cost": 32.74,
            "minutes": 93.53,
            "cost_per_minute": 0.35
        },
        "Saturday": {
            "cost": 19.15,
            "minutes": 54.72,
            "cost_per_minute": 0.35
        },
        "Week_Cost": "0.00",
        "Number_Of_Calls": 90
    },
    {
        "user_id": 80,
        "Sunday": null,
        "Monday": null,
        "Tuesday": null,
        "Wednesday": null,
        "Thursday": null,
        "Friday": {
            "minutes": 76.7833,
            "daily_cost": null,
            "total_calls": 19,
            "overage_calls": 0,
            "total_inbound": 19,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Saturday": {
            "minutes": 35.8333,
            "daily_cost": null,
            "total_calls": 13,
            "overage_calls": 0,
            "total_inbound": 13,
            "call_threshold": 0,
            "total_outbound": 0,
            "phone_per_minute": null,
            "daily_overage_cost": 0,
            "over_threshold_active": false,
            "phone_per_minute_overage": null
        },
        "Week_Cost": "0.00",
        "Number_Of_Calls": 32
    },
    {
        "user_id": 80,
        "Sunday": {
            "cost": 14.44,
            "minutes": 41.25,
            "cost_per_minute": 0.35
        },
        "Monday": {
            "cost": 124.19,
            "minutes": 354.8,
            "cost_per_minute": 0.35
        },
        "Tuesday": {
            "cost": 41.83,
            "minutes": 119.5,
            "cost_per_minute": 0.35
        },
        "Wednesday": {
            "cost": 69.56,
            "minutes": 198.73,
            "cost_per_minute": 0.35
        },
        "Thursday": {
            "cost": 43.1,
            "minutes": 123.13,
            "cost_per_minute": 0.35
        },
        "Friday": null,
        "Saturday": null,
        "Week_Cost": null,
        "Number_Of_Calls": null
    }
]
*/
function fetchCallsCostRecords(userId) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
	"table_name": "Daily_Calls_Cost_Record",
	"columns": [
		"user_id",
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
		"Week_Cost",
		"Number_Of_Calls"
	],
	"filters": {
		"user_id": userId
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}
>>>>>>> 04d702d28212809893f203ae6ec23ec16f2479d3
