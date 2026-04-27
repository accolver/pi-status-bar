/*
 * pi-status-bar
 *
 * MIT License
 * Copyright (c) 2026 Alan Colver
 *
 * Theme-aware Pi TUI footer that shows git status and an AI-generated
 * resume title for the current session.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { AssistantMessage } from "@mariozechner/pi-ai";
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
	source?: "ai" | "fallback";
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
const MAX_SESSION_NAME_CHARS = 48;

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
		"Create an extremely short Pi session title for this conversation.",
		"Return one brief statement only, no markdown, no bullets.",
		"Capture only the main topic and completed/current work.",
		"Omit next steps, recommendations, and secondary details.",
		"Prefer 3-6 words. Hard limit: 48 characters.",
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
				source: data.source === "fallback" ? "fallback" : "ai",
			};
		}
	}
	return undefined;
};

const formatPending = (git: GitState): string => {
	if (git.pending === null) return "?";
	if (git.pending === 0) return "✓";

	const parts: string[] = [`±${git.pending}`];
	if (git.staged) parts.push(`s${git.staged}`);
	if (git.unstaged) parts.push(`u${git.unstaged}`);
	if (git.untracked) parts.push(`n${git.untracked}`);
	return parts.join(" ");
};

const formatCount = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

export default function (pi: ExtensionAPI) {
	let renderFooter: (() => void) | undefined;
	let summary = "";
	let summaryUpdatedAt = 0;
	let summaryEntryCount = 0;
	let summaryIsFallback = false;
	let summarizing = false;
	let lastSummaryError: string | undefined;
	let git: GitState = { ...defaultGitState };
	let gitTimer: NodeJS.Timeout | undefined;
	let summaryTimer: NodeJS.Timeout | undefined;
	let enabled = true;

	const requestRender = () => renderFooter?.();

	const applySummary = (nextSummary: string, entryCount: number, isFallback: boolean) => {
		summary = nextSummary;
		summaryUpdatedAt = Date.now();
		summaryEntryCount = entryCount;
		summaryIsFallback = isFallback;
		if (!isFallback) lastSummaryError = undefined;
		pi.setSessionName(summary);
		pi.appendEntry(CUSTOM_TYPE, {
			summary,
			updatedAt: summaryUpdatedAt,
			entryCount: summaryEntryCount,
			source: isFallback ? "fallback" : "ai",
		});
		requestRender();
	};

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
		if (!force && !summaryIsFallback && summaryUpdatedAt > 0 && !hasEnoughNewConversation) return;

		const model = ctx.model;
		if (!model) {
			lastSummaryError = "No model selected";
			return;
		}

		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				lastSummaryError = auth.error;
				return;
			}

			summarizing = true;
			requestRender();
			const response = await completeSimple(
				model,
				{
					systemPrompt: "You write concise session titles for a coding-agent terminal UI.",
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
					signal: ctx.signal,
				},
			);

			if (response.stopReason === "error" || response.stopReason === "aborted") {
				lastSummaryError = response.errorMessage ?? `Model stopped: ${response.stopReason}`;
				return;
			}

			const nextSummary = cleanSummary(
				response.content
					.filter((part): part is { type: "text"; text: string } => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
			);
			if (!nextSummary) {
				lastSummaryError = "Model returned no text";
				return;
			}

			applySummary(nextSummary, entryCount, false);
		} catch (error) {
			lastSummaryError = error instanceof Error ? error.message : String(error);
		} finally {
			summarizing = false;
			requestRender();
		}
	};

	const getUsageText = (ctx: ExtensionContext): string => {
		let input = 0;
		let output = 0;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const message = entry.message as AssistantMessage;
			input += message.usage?.input ?? 0;
			output += message.usage?.output ?? 0;
		}
		const model = ctx.model?.id ?? "no-model";
		const usage = ctx.getContextUsage();
		const contextPercent = usage?.percent === null || usage?.percent === undefined ? "" : ` ${Math.round(usage.percent)}%`;
		return `${model}${contextPercent} ↑${formatCount(input)} ↓${formatCount(output)}`;
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
					const leftRaw = `⑂ ${branch} ${formatPending(git)}`;
					const centerRaw = summary.trim();
					const rightRaw = getUsageText(ctx);

					const left = theme.fg(git.pending && git.pending > 0 ? "warning" : "success", leftRaw);
					const right = theme.fg("dim", truncateToWidth(rightRaw, Math.min(32, Math.max(12, Math.floor(width * 0.3))), "…"));
					const centerColor = summaryIsFallback ? "warning" : "dim";
					const reserved = visibleWidth(left) + visibleWidth(right) + 2;
					const center = centerRaw ? theme.fg(centerColor, truncateToWidth(centerRaw, Math.max(0, width - reserved), "…")) : "";
					const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(center) - visibleWidth(right)));
					return [truncateToWidth(left + (center ? " " + center : "") + gap + right, width, "")];
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
		if (saved?.source !== "fallback") {
			summary = saved?.summary ?? pi.getSessionName() ?? summary;
			summaryUpdatedAt = saved?.updatedAt ?? 0;
			summaryEntryCount = saved?.entryCount ?? 0;
			summaryIsFallback = false;
			if (summary) pi.setSessionName(summary);
		} else {
			summary = "";
			summaryUpdatedAt = 0;
			summaryEntryCount = saved.entryCount;
			summaryIsFallback = false;
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
			ctx.ui.notify(lastSummaryError ? `Session bar refreshed; AI summary failed: ${lastSummaryError}` : "Session bar refreshed", lastSummaryError ? "warning" : "info");
		},
	});

	pi.registerCommand("session-bar-debug", {
		description: "Show status bar summary diagnostics",
		handler: async (_args, ctx) => {
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
			const auth = ctx.model ? await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model) : undefined;
			ctx.ui.notify(
				[
					`model=${model}`,
					`summarySource=${summaryIsFallback ? "fallback" : "ai"}`,
					`summaryEntries=${summaryEntryCount}`,
					`auth=${auth ? (auth.ok ? "ok" : auth.error) : "none"}`,
					`lastError=${lastSummaryError ?? "none"}`,
				].join(" • "),
				lastSummaryError ? "warning" : "info",
			);
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
