import { describe, expect, test } from "bun:test";
import { formatPullRequestMarker, parsePullRequestNumber } from "../extensions/status-bar";

describe("pull request status", () => {
	test("parses a GitHub CLI pull request number", () => {
		expect(parsePullRequestNumber("123\n")).toBe(123);
	});

	test("rejects missing or malformed pull request numbers", () => {
		expect(parsePullRequestNumber("")).toBeNull();
		expect(parsePullRequestNumber("not-a-number\n")).toBeNull();
		expect(parsePullRequestNumber("0\n")).toBeNull();
	});

	test("formats an existing pull request as a hash-prefixed marker", () => {
		expect(formatPullRequestMarker(123)).toBe(" #123");
		expect(formatPullRequestMarker(null)).toBe("");
	});
});
