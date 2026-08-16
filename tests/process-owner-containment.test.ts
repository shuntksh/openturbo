import { describe, expect, test } from "bun:test";
import {
	hasInheritedProcessContainment,
	inheritProcessContainment,
	INHERITED_PROCESS_CONTAINMENT,
	PROCESS_CONTAINMENT_ENV,
} from "../src/process-owner/containment";

describe("process containment contract", () => {
	test("accepts only the inherited contract value", () => {
		expect(hasInheritedProcessContainment({})).toBe(false);
		expect(
			hasInheritedProcessContainment({ [PROCESS_CONTAINMENT_ENV]: "1" }),
		).toBe(false);
		expect(
			hasInheritedProcessContainment({
				[PROCESS_CONTAINMENT_ENV]: INHERITED_PROCESS_CONTAINMENT,
			}),
		).toBe(true);
	});

	test("preserves the child environment and enforces inherited containment", () => {
		expect(
			inheritProcessContainment({
				KEEP: "yes",
				[PROCESS_CONTAINMENT_ENV]: "invalid",
			}),
		).toEqual({
			KEEP: "yes",
			[PROCESS_CONTAINMENT_ENV]: INHERITED_PROCESS_CONTAINMENT,
		});
	});
});
