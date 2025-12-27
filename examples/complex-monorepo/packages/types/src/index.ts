export interface User {
	id: string;
	name: string;
	email: string;
}

export interface Config {
	apiUrl: string;
	retryCount: number;
}
