/*ANCHOR Startup Pull request*/
window.onload = function() {
	console.log("App.js loaded and running.");

	/*ANCHOR etch User List */
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");

	const raw = JSON.stringify({
	"table_name": "users",
	"columns": [
		"id",
		"first_name",
		"last_name",
		"email"
	],
	"filters": {
		"is_admin": "0"
	}
	});

	const requestOptions = {
	method: "POST",
	headers: myHeaders,
	body: raw,
	redirect: "follow"
	};

	fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", requestOptions)
	.then((response) => {
		// Try to parse JSON; some endpoints may still return text
		const ct = response.headers.get("content-type") || "";
		if (ct.includes("application/json")) return response.json();
		return response.text();
	})
	.then((result) => {
		console.log("Fetch result:", result);
		// ANCHOR Create headers immediately from the original request
		createTable(raw, "user-list");

		//ANCHOR Add other data columns to header
		const table = document.getElementById("user-list").querySelector("table");
		if (table) {
			const thead = table.querySelector("thead");
			if (thead) {
				const headerRow = thead.querySelector("tr");
				if (headerRow) {
					["Packages", "Money we made"].forEach((headerText) => {
						const th = document.createElement("th");
						th.textContent = headerText;
						headerRow.appendChild(th);
					});
				}
			}
		}
			

		// ANCHOR If the webhook returned rows (array or object with rows/data), populate them
		try {
			let rows = null;
			if (Array.isArray(result)) rows = result;
			else if (result && typeof result === "object") {
				// common shapes: { rows: [...] } or { data: [...] } or { result: [...] }
				rows = result.rows || result.data || result.result || null;
			} else if (typeof result === "string") {
				// occasionally the endpoint returns JSON as a string
				try {
					const parsed = JSON.parse(result);
					rows = parsed.rows || parsed.data || parsed.result || (Array.isArray(parsed) ? parsed : null);
				} catch (e) {
					// not JSON; ignore
					rows = null;
				}
			}

			if (rows && Array.isArray(rows)) {
				populateRows("user-list", rows);
			} else {
				console.log("No row array found in response to populate table.");
			}
		} catch (err) {
			console.error("Error processing fetch result:", err);
		
		}

		//ANCHOR: Row add ins 
		const tbody = document.getElementById("user-list-tbody");
		if (tbody) {
    tbody.querySelectorAll("tr").forEach(async (tr) => {
        const userId = tr.firstChild ? tr.firstChild.textContent : null;
        console.log("User ID for this row:", userId);
        
        try {
            // Wait for the fetch to complete
            const response = await fetch("https://n8n.workflows.organizedchaos.cc/webhook/da176ae9-496c-4f08-baf5-6a78a6a42adb", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "table_name": "manual_charges",
                    "columns": ["user_id", "frequency", "cost", "name"],
                    "filters": { "user_id": userId }
                })
            });

            // Create packages cell first (we'll populate it based on the response)
            const packagesTd = document.createElement("td");
            packagesTd.textContent = "No packages";  // Default text
            tr.appendChild(packagesTd);

            try {
                const text = await response.text();
                if (text && text.trim() !== '') {
                    const data = JSON.parse(text);
                    const packages = Array.isArray(data) ? data : 
                                   data.rows || data.data || data.result || [];
                    
                    if (packages.length > 0) {
                        const packageStrings = packages.map(pkg => 
                            `${pkg.name} (${pkg.frequency}): $${pkg.cost}`
                        );
                        packagesTd.textContent = packageStrings.join("; ");
                    }
                }
            } catch (error) {
                console.log("Could not load packages for user", userId, ":", error.message);
                // We don't need to do anything else since we already set "No packages" as default
            }

            // TODO: Add money made cell
            const moneyTd = document.createElement("td");
            moneyTd.textContent = "$0.00"; //NOTE - placeholder until calculation is implemented
			calculateMoneyMade(userId);
            tr.appendChild(moneyTd);

        } catch (error) {
            console.error("Error processing packages for user", userId, ":", error.message);
            // Add empty cells if there's an error
            const errorTd = document.createElement("td");
            errorTd.textContent = "Error loading packages";
            tr.appendChild(errorTd);
            
            const moneyTd = document.createElement("td");
            moneyTd.textContent = "N/A";
            tr.appendChild(moneyTd);
        }
    });
}
	})
	.catch((error) => console.error(error));
	console.log("Fetch request sent.");
	
}

/* ANCHOR Create Table */
function createTable(data, tableId) {
	console.log("Creating Table",tableId);
	console.log("Data:",data);
	const container = document.getElementById(tableId);
	if (!container) {
		console.error("Container not found:", tableId);
		return;
	}
	// Clear any existing table
	container.innerHTML = "";

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
