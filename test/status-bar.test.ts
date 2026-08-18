import { afterEach, describe, expect, mock, test } from "bun:test";
import extension, {
	cleanSummary,
	formatPullRequestMarker,
	parsePullRequestNumber,
	truncateToWidth,
	visibleWidth,
} from "../extensions/status-bar";

type RegisteredEvents = Record<string, (event: unknown, ctx: MockContext) => Promise<void> | void>;
type RegisteredCommands = Record<string, { handler: (args: string, ctx: MockContext) => Promise<void> | void }>;

type MockContext = {
	mode: "tui" | "rpc" | "print" | "json";
	hasUI: boolean;
	cwd: string;
	ui: {
		setFooter: (footer: unknown) => void;
		notify: (message: string, level?: string) => void;
		input: (prompt: string, initial?: string) => Promise<string | undefined>;
	};
	sessionManager: {
		getEntries: () => unknown[];
		getBranch: () => unknown[];
	};
	model?: unknown;
	modelRegistry: {
		getApiKeyAndHeaders: () => Promise<{ ok: false; error: string } | { ok: true; apiKey: string; headers: Record<string, string> }>;
	};
	getContextUsage: () => undefined;
};

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
	globalThis.setInterval = originalSetInterval;
	globalThis.clearInterval = originalClearInterval;
	globalThis.setTimeout = originalSetTimeout;
	globalThis.clearTimeout = originalClearTimeout;
});

const installMockTimers = () => {
	let nextId = 1;
	const active = new Set<number>();
	globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
		void handler;
		void timeout;
		const id = nextId++;
		active.add(id);
		return id;
	}) as typeof setInterval;
	globalThis.clearInterval = ((id?: number) => {
		if (typeof id === "number") active.delete(id);
	}) as typeof clearInterval;
	return active;
};

const createPiMock = () => {
	const events: RegisteredEvents = {};
	const commands: RegisteredCommands = {};
	const footerCalls: unknown[] = [];
	const notifications: string[] = [];
	const appendedEntries: unknown[] = [];
	return {
		events,
		commands,
		footerCalls,
		notifications,
		appendedEntries,
		pi: {
			on: (name: string, handler: RegisteredEvents[string]) => {
				events[name] = handler;
			},
			registerShortcut: () => {},
			registerCommand: (name: string, command: RegisteredCommands[string]) => {
				commands[name] = command;
			},
			setSessionName: () => {},
			getSessionName: () => "",
			appendEntry: (_customType: string, data: unknown) => appendedEntries.push(data),
			exec: async (command: string, args: string[]) => {
				if (command !== "git") return { code: 1, stdout: "", stderr: "" };
				if (args[0] === "branch") return { code: 0, stdout: "main\n", stderr: "" };
				if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
				if (args[0] === "rev-parse") return { code: 0, stdout: "true\n.git\n.git\n/tmp/repo\n", stderr: "" };
				return { code: 1, stdout: "", stderr: "" };
			},
		},
		createContext: (mode: MockContext["mode"]): MockContext => ({
			mode,
			hasUI: mode === "tui" || mode === "rpc",
			cwd: "/tmp/repo",
			ui: {
				setFooter: (footer: unknown) => footerCalls.push(footer),
				notify: (message: string) => notifications.push(message),
				input: async () => undefined,
			},
			sessionManager: {
				getEntries: () => [],
				getBranch: () => [],
			},
			modelRegistry: {
				getApiKeyAndHeaders: async () => ({ ok: false, error: "No auth" }),
			},
			getContextUsage: () => undefined,
		}),
	};
};

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

describe("summary and footer text", () => {
	test("strips terminal control sequences from summaries", () => {
		expect(cleanSummary("\u001B]0;owned\u0007Fix \u001B[31mtests\u001B[0m\nnow\u0007")).toBe("Fix tests now");
	});

	test("uses display width for wide characters while truncating", () => {
		expect(visibleWidth("界a")).toBe(3);
		expect(truncateToWidth("界abc", 4)).toBe("界a…");
	});
});

describe("runtime lifecycle", () => {
	test("does not install footers or timers outside TUI mode", async () => {
		const activeTimers = installMockTimers();
		const piMock = createPiMock();
		extension(piMock.pi as never);

		await piMock.events.session_start({}, piMock.createContext("rpc"));

		expect(piMock.footerCalls).toHaveLength(0);
		expect(activeTimers.size).toBe(0);
	});

	test("toggle stops and restarts status bar timers in TUI mode", async () => {
		const activeTimers = installMockTimers();
		const piMock = createPiMock();
		const ctx = piMock.createContext("tui");
		extension(piMock.pi as never);

		await piMock.events.session_start({}, ctx);
		expect(activeTimers.size).toBe(2);

		await piMock.commands["session-bar-toggle"].handler("", ctx);
		expect(activeTimers.size).toBe(0);

		await piMock.commands["session-bar-toggle"].handler("", ctx);
		expect(activeTimers.size).toBe(2);
	});

	test("summary refresh times out instead of staying stuck", async () => {
		mock.module("@earendil-works/pi-ai/compat", () => ({
			completeSimple: () => new Promise(() => {}),
		}));
		globalThis.setTimeout = ((handler: TimerHandler) => {
			if (typeof handler === "function") handler();
			return 1;
		}) as typeof setTimeout;
		globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
		const piMock = createPiMock();
		const ctx = piMock.createContext("tui");
		ctx.model = { id: "test-model" };
		ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "test", headers: {} });
		ctx.sessionManager.getBranch = () => [
			{ type: "message", message: { role: "user", content: "Summarize this session" } },
		];
		extension(piMock.pi as never);

		await piMock.commands["session-bar-refresh"].handler("", ctx);

		expect(piMock.appendedEntries).toHaveLength(1);
		expect(piMock.notifications.at(-1)).toContain("timed out");
	});
});
