/*Startup Pull request*/
window.onload = function() {
	console.log("App.js loaded and running.");

	/*Fetch User List */
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
		// Create headers immediately from the original request
		createTable(raw, "user-list");

		// If the webhook returned rows (array or object with rows/data), populate them
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
		
		//make each row clickable to open user detail view
		const tbody = document.getElementById("user-list-tbody");
		if (tbody) {
			tbody.querySelectorAll("tr").forEach((tr) => {
				tr.addEventListener("click", () => {
					const userId = tr.firstChild ? tr.firstChild.textContent : null;
					if (userId) {
						// TODO: Open user detail view - replace with actual logic
						console.log("Row clicked, open detail for user ID:", userId);
						pullClientTable(userId);
					}
				});
			});
		}
	})
	.catch((error) => console.error(error));
	console.log("Fetch request sent.");
	
}

/* Create Table */
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
	// Allow CSS hooks if desired

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
	createTable(raw,'client-indiviual-table');

}
