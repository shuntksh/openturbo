import type { User } from "@complex/types";
import { formatDate, sleep } from "@complex/utils";

const startServer = async () => {
	console.log("Starting server...");
	await sleep(100);
	const user: User = { id: "1", name: "Admin", email: "admin@example.com" };
	console.log(
		`Server started at ${formatDate(new Date())} for user ${user.name}`,
	);
};

startServer();
