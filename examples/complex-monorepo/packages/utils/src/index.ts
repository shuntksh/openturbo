import { TIMEOUT_MS } from "@complex/constants";

export const sleep = (ms: number = TIMEOUT_MS) =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const formatDate = (date: Date) => date.toISOString();
