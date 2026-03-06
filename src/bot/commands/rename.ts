import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const RENAME_CALLBACK_PREFIX = "rename:";
const RENAME_CALLBACK_CANCEL = `${RENAME_CALLBACK_PREFIX}cancel`;

interface RenameMetadata {
  flow: "rename";
  stage: "awaiting_title";
  messageId: number;
  sessionID: string;
  directory: string;
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseRenameMetadata(state: InteractionState | null): RenameMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const sessionID = state.metadata.sessionID;
  const directory = state.metadata.directory;

  if (
    flow !== "rename" ||
    stage !== "awaiting_title" ||
    typeof messageId !== "number" ||
    typeof sessionID !== "string" ||
    typeof directory !== "string"
  ) {
    return null;
  }

  return {
    flow,
    stage,
    messageId,
    sessionID,
    directory,
  };
}

function clearRenameInteraction(reason: string): void {
  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

function buildRenameKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("inline.button.cancel"), RENAME_CALLBACK_CANCEL);
}

export async function renameCommand(ctx: CommandContext<Context>): Promise<void> {
  const currentSession = getCurrentSession();
  if (!currentSession) {
    await ctx.reply(t("rename.no_active_session"));
    return;
  }

  const promptMessage = await ctx.reply(t("rename.prompt"), {
    reply_markup: buildRenameKeyboard(),
  });

  interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    metadata: {
      flow: "rename",
      stage: "awaiting_title",
      messageId: promptMessage.message_id,
      sessionID: currentSession.id,
      directory: currentSession.directory,
    },
  });

  logger.debug(
    `[Rename] Started rename flow: session=${currentSession.id}, messageId=${promptMessage.message_id}`,
  );
}

export async function handleRenameCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== RENAME_CALLBACK_CANCEL) {
    return false;
  }

  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  clearRenameInteraction("rename_cancelled");

  await ctx.answerCallbackQuery({ text: t("rename.cancelled_callback") }).catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  return true;
}

export async function handleRenameTextInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  if (!metadata) {
    return false;
  }

  const newTitle = text.trim();
  if (!newTitle) {
    await ctx.reply(t("rename.empty_title"));
    return true;
  }

  const currentSession = getCurrentSession();
  if (!currentSession || currentSession.id !== metadata.sessionID) {
    clearRenameInteraction("rename_session_missing");
    await ctx.reply(t("rename.no_active_session"));
    return true;
  }

  try {
    const { data: updatedSession, error } = await opencodeClient.session.update({
      sessionID: metadata.sessionID,
      directory: metadata.directory,
      title: newTitle,
    });

    if (error || !updatedSession) {
      throw error || new Error("No session returned after rename");
    }

    const updatedTitle = updatedSession.title?.trim() || newTitle;
    setCurrentSession({
      id: currentSession.id,
      title: updatedTitle,
      directory: currentSession.directory,
    });

    if (pinnedMessageManager.isInitialized()) {
      await pinnedMessageManager.onSessionTitleUpdate(updatedTitle);
    }

    clearRenameInteraction("rename_completed");

    if (ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
    }

    await ctx.reply(t("rename.success", { title: updatedTitle }));

    logger.info(`[Rename] Session renamed: session=${metadata.sessionID}, title="${updatedTitle}"`);
  } catch (error) {
    logger.error("[Rename] Failed to rename session:", error);
    await ctx.reply(t("rename.error"));
  }

  return true;
}
