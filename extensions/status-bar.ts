/*
 * pi-status-bar
 *
 * MIT License
 * Copyright (c) 2026 Alan Colver
 *
 * Theme-aware Pi TUI footer that shows git status and an AI-generated
 * resume title for the current session.
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
};

type SessionEntry = {
	type: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		content?: unknown;
	};
};

type SummaryEntry = {
	summary: string;
	updatedAt: number;
	entryCount: number;
};

type GitState = {
	branch: string | null;
	pending: number | null;
	staged: number | null;
	unstaged: number | null;
	untracked: number | null;
};

const CUSTOM_TYPE = "pi-status-bar-summary";
const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
const SUMMARY_MIN_ENTRY_DELTA = 2;
const GIT_INTERVAL_MS = 15 * 1000;
const MAX_CONVERSATION_CHARS = 24_000;
const MAX_SESSION_NAME_CHARS = 90;

const defaultGitState: GitState = {
	branch: null,
	pending: null,
	staged: null,
	unstaged: null,
	untracked: null,
};

const extractTextParts = (content: unknown): string[] => {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];

	const textParts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		}
	}
	return textParts;
};

const extractToolCallLines = (content: unknown): string[] => {
	if (!Array.isArray(content)) return [];

	const toolCalls: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type !== "toolCall" || typeof block.name !== "string") continue;
		toolCalls.push(`Assistant used tool: ${block.name}`);
	}
	return toolCalls;
};

const buildConversationText = (entries: SessionEntry[]): string => {
	const sections: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) continue;

		const role = entry.message.role;
		if (role !== "user" && role !== "assistant") continue;

		const lines: string[] = [];
		const text = extractTextParts(entry.message.content).join("\n").trim();
		if (text) lines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
		if (role === "assistant") lines.push(...extractToolCallLines(entry.message.content));
		if (lines.length > 0) sections.push(lines.join("\n"));
	}

	const fullText = sections.join("\n\n");
	if (fullText.length <= MAX_CONVERSATION_CHARS) return fullText;
	return fullText.slice(-MAX_CONVERSATION_CHARS);
};

const buildSummaryPrompt = (conversationText: string): string =>
	[
		"Create a concise Pi session resume title for this conversation.",
		"Return one brief statement only, no markdown, no bullets.",
		"It must capture the current objective, important progress, and next action if obvious.",
		`Keep it under ${MAX_SESSION_NAME_CHARS} characters if possible.`,
		"",
		"<conversation>",
		conversationText,
		"</conversation>",
	].join("\n");

const cleanSummary = (text: string): string => {
	const singleLine = text.replace(/\s+/g, " ").trim().replace(/^['\"]|['\"]$/g, "");
	if (singleLine.length <= MAX_SESSION_NAME_CHARS) return singleLine;
	return `${singleLine.slice(0, MAX_SESSION_NAME_CHARS - 1).trim()}…`;
};

const countEntries = (entries: SessionEntry[]): number =>
	entries.filter((entry) => entry.type === "message" && entry.message?.role).length;

const readLatestSummary = (entries: SessionEntry[]): SummaryEntry | undefined => {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
		const data = entry.data as Partial<SummaryEntry> | undefined;
		if (data && typeof data.summary === "string" && typeof data.updatedAt === "number") {
			return {
				summary: data.summary,
				updatedAt: data.updatedAt,
				entryCount: typeof data.entryCount === "number" ? data.entryCount : 0,
			};
		}
	}
	return undefined;
};

const formatPending = (git: GitState): string => {
	if (git.pending === null) return "changes ?";
	if (git.pending === 0) return "clean";

	const parts: string[] = [];
	if (git.staged) parts.push(`${git.staged} staged`);
	if (git.unstaged) parts.push(`${git.unstaged} unstaged`);
	if (git.untracked) parts.push(`${git.untracked} new`);
	return parts.length > 0 ? parts.join(", ") : `${git.pending} changes`;
};

export default function (pi: ExtensionAPI) {
	let renderFooter: (() => void) | undefined;
	let summary = "No summary yet";
	let summaryUpdatedAt = 0;
	let summaryEntryCount = 0;
	let summarizing = false;
	let git: GitState = { ...defaultGitState };
	let gitTimer: NodeJS.Timeout | undefined;
	let summaryTimer: NodeJS.Timeout | undefined;
	let enabled = true;

	const requestRender = () => renderFooter?.();

	const refreshGit = async (ctx: ExtensionContext) => {
		try {
			const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd, timeout: 2000 });
			const statusResult = await pi.exec("git", ["status", "--porcelain=v1"], { cwd: ctx.cwd, timeout: 3000 });

			if (branchResult.code !== 0 || statusResult.code !== 0) {
				git = { ...defaultGitState };
				requestRender();
				return;
			}

			const lines = statusResult.stdout.split("\n").filter((line) => line.trim().length > 0);
			let staged = 0;
			let unstaged = 0;
			let untracked = 0;
			for (const line of lines) {
				const x = line[0];
				const y = line[1];
				if (x === "?" && y === "?") {
					untracked++;
					continue;
				}
				if (x && x !== " ") staged++;
				if (y && y !== " ") unstaged++;
			}

			git = {
				branch: branchResult.stdout.trim() || null,
				pending: lines.length,
				staged,
				unstaged,
				untracked,
			};
			requestRender();
		} catch {
			git = { ...defaultGitState };
			requestRender();
		}
	};

	const refreshSummary = async (ctx: ExtensionContext, force = false) => {
		if (summarizing) return;

		const branch = ctx.sessionManager.getBranch() as SessionEntry[];
		const entryCount = countEntries(branch);
		const conversationText = buildConversationText(branch);
		if (!conversationText.trim()) return;

		const hasEnoughNewConversation = entryCount - summaryEntryCount >= SUMMARY_MIN_ENTRY_DELTA;
		if (!force && summaryUpdatedAt > 0 && !hasEnoughNewConversation) return;

		const model = ctx.model;
		if (!model) return;

		summarizing = true;
		requestRender();
		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) return;

			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: buildSummaryPrompt(conversationText) }],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
				},
			);

			const nextSummary = cleanSummary(
				response.content
					.filter((part): part is { type: "text"; text: string } => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
			);
			if (!nextSummary) return;

			summary = nextSummary;
			summaryUpdatedAt = Date.now();
			summaryEntryCount = entryCount;
			pi.setSessionName(summary);
			pi.appendEntry(CUSTOM_TYPE, { summary, updatedAt: summaryUpdatedAt, entryCount: summaryEntryCount });
		} finally {
			summarizing = false;
			requestRender();
		}
	};

	const installFooter = (ctx: ExtensionContext) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			renderFooter = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => {
				void refreshGit(ctx);
				tui.requestRender();
			});

			return {
				dispose: () => {
					unsub();
					renderFooter = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = git.branch ?? footerData.getGitBranch() ?? "no git";
					const leftRaw = `⑂ ${branch} • ${formatPending(git)}`;
					const summaryText = summarizing ? `summarizing… ${summary}` : summary;
					const rightRaw = `AI: ${summaryText}`;

					const left = theme.fg(git.pending && git.pending > 0 ? "warning" : "success", leftRaw);
					const right = theme.fg(summarizing ? "accent" : "dim", rightRaw);
					const minGap = "  ";
					const availableRightWidth = Math.max(0, width - visibleWidth(leftRaw) - visibleWidth(minGap));
					const clippedRight = truncateToWidth(right, availableRightWidth, "…");
					const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(clippedRight)));
					return [truncateToWidth(left + gap + clippedRight, width, "")];
				},
			};
		});
	};

	const startTimers = (ctx: ExtensionContext) => {
		gitTimer = setInterval(() => void refreshGit(ctx), GIT_INTERVAL_MS);
		summaryTimer = setInterval(() => void refreshSummary(ctx), SUMMARY_INTERVAL_MS);
	};

	const stopTimers = () => {
		if (gitTimer) clearInterval(gitTimer);
		if (summaryTimer) clearInterval(summaryTimer);
		gitTimer = undefined;
		summaryTimer = undefined;
	};

	pi.on("session_start", async (_event, ctx) => {
		const saved = readLatestSummary(ctx.sessionManager.getEntries() as SessionEntry[]);
		if (saved) {
			summary = saved.summary;
			summaryUpdatedAt = saved.updatedAt;
			summaryEntryCount = saved.entryCount;
			pi.setSessionName(summary);
		} else if (pi.getSessionName()) {
			summary = pi.getSessionName() ?? summary;
		}

		if (!ctx.hasUI) return;

		if (enabled) installFooter(ctx);
		await refreshGit(ctx);
		void refreshSummary(ctx);
		startTimers(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		await refreshGit(ctx);
		void refreshSummary(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopTimers();
		ctx.ui.setFooter(undefined);
	});

	pi.registerCommand("session-bar-refresh", {
		description: "Refresh the sticky git/session summary bar now",
		handler: async (_args, ctx) => {
			await refreshGit(ctx);
			await refreshSummary(ctx, true);
			ctx.ui.notify("Session bar refreshed", "info");
		},
	});

	pi.registerCommand("session-bar-toggle", {
		description: "Toggle the sticky git/session summary bar",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				installFooter(ctx);
				await refreshGit(ctx);
				void refreshSummary(ctx);
				ctx.ui.notify("Session bar enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Session bar disabled", "info");
			}
		},
	});
}
