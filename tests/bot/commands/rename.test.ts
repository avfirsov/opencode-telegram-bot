import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  handleRenameCallback,
  handleRenameTextInput,
  renameCommand,
} from "../../../src/bot/commands/rename.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentSession: {
    id: "session-1",
    title: "Old title",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  sessionUpdateMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => false),
  pinnedTitleUpdateMock: vi.fn(),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: vi.fn((session) => {
    mocked.currentSession = session;
    mocked.setCurrentSessionMock(session);
  }),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      update: mocked.sessionUpdateMock,
    },
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    onSessionTitleUpdate: mocked.pinnedTitleUpdateMock,
  },
}));

function createCommandContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
  } as unknown as Context;
}

function createTextContext(text: string): Context {
  return {
    chat: { id: 777 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue({ message_id: 1000 }),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function startRenameInteraction(messageId: number): void {
  interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    metadata: {
      flow: "rename",
      stage: "awaiting_title",
      messageId,
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
    },
  });
}

describe("bot/commands/rename", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");

    mocked.currentSession = {
      id: "session-1",
      title: "Old title",
      directory: "D:\\Projects\\Repo",
    };

    mocked.sessionUpdateMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReturnValue(false);
    mocked.pinnedTitleUpdateMock.mockReset();
  });

  it("does not start rename flow without active session", async () => {
    mocked.currentSession = null;
    const ctx = createCommandContext(100);

    await renameCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("rename.no_active_session"));
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("asks for new title and starts mixed custom interaction", async () => {
    const ctx = createCommandContext(123);

    await renameCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("rename:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.flow).toBe("rename");
    expect(state?.metadata.stage).toBe("awaiting_title");
    expect(state?.metadata.messageId).toBe(123);
  });

  it("rejects empty title", async () => {
    startRenameInteraction(321);
    const ctx = createTextContext("   ");

    const handled = await handleRenameTextInput(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.empty_title"));
    expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
    expect(interactionManager.getSnapshot()?.metadata.flow).toBe("rename");
  });

  it("renames session on valid title and clears interaction", async () => {
    startRenameInteraction(555);
    mocked.sessionUpdateMock.mockResolvedValue({
      data: {
        id: "session-1",
        title: "New title from API",
      },
      error: null,
    });
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedTitleUpdateMock.mockResolvedValue(undefined);

    const ctx = createTextContext("  My new title  ");
    const handled = await handleRenameTextInput(ctx);

    expect(handled).toBe(true);
    expect(mocked.sessionUpdateMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      title: "My new title",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "New title from API",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.pinnedTitleUpdateMock).toHaveBeenCalledWith("New title from API");
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 555);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.success", { title: "New title from API" }));
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("shows error and keeps interaction active when rename fails", async () => {
    startRenameInteraction(777);
    mocked.sessionUpdateMock.mockResolvedValue({
      data: null,
      error: new Error("rename failed"),
    });

    const ctx = createTextContext("Title");
    const handled = await handleRenameTextInput(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.error"));
    expect(interactionManager.getSnapshot()?.metadata.flow).toBe("rename");
  });

  it("cancels active rename flow from callback", async () => {
    startRenameInteraction(888);
    const ctx = createCallbackContext("rename:cancel", 888);

    const handled = await handleRenameCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.cancelled_callback"),
    });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects stale cancel callback", async () => {
    startRenameInteraction(999);
    const ctx = createCallbackContext("rename:cancel", 1000);

    const handled = await handleRenameCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.inactive_callback"),
      show_alert: true,
    });
    expect(interactionManager.getSnapshot()?.metadata.flow).toBe("rename");
  });
});
