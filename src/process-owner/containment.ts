export const PROCESS_CONTAINMENT_ENV = "OT_PROCESS_CONTAINMENT";
export const INHERITED_PROCESS_CONTAINMENT = "inherited";

export function hasInheritedProcessContainment(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env[PROCESS_CONTAINMENT_ENV] === INHERITED_PROCESS_CONTAINMENT;
}

export function inheritProcessContainment(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	return {
		...env,
		[PROCESS_CONTAINMENT_ENV]: INHERITED_PROCESS_CONTAINMENT,
	};
}
