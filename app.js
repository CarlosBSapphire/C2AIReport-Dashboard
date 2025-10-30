/*Startup Pull request*/
window.onload = function() {
	console.log("App.js loaded and running.");
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
	.then((response) => response.text())
	.then((result) => console.log(result))
	.catch((error) => console.error(error));
}
