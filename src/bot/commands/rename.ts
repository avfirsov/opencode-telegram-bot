import { Context, InlineKeyboard, CommandContext } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { setCurrentSession } from "../../session/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const RENAME_CALLBACK_PREFIX = "rename:";
const RENAME_CALLBACK_CANCEL = `${RENAME_CALLBACK_PREFIX}cancel`;

interface RenameMetadata {
  sessionId: string;
  sessionDirectory: string;
  messageId: number;
}

function parseRenameMetadata(
  state: ReturnType<typeof interactionManager.getSnapshot>,
): RenameMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const sessionId = state.metadata.sessionId as string;
  const sessionDirectory = state.metadata.sessionDirectory as string;
  const messageId = state.metadata.messageId as number;

  if (
    typeof sessionId !== "string" ||
    typeof sessionDirectory !== "string" ||
    typeof messageId !== "number"
  ) {
    return null;
  }

  return { sessionId, sessionDirectory, messageId };
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export async function renameCommand(ctx: CommandContext<Context>): Promise<void> {
  const currentSession = getCurrentSession();

  if (!currentSession) {
    await ctx.reply(t("rename.no_session"));
    return;
  }

  const keyboard = new InlineKeyboard().text(t("inline.button.cancel"), RENAME_CALLBACK_CANCEL);

  const message = await ctx.reply(t("rename.prompt", { currentTitle: currentSession.title }), {
    reply_markup: keyboard,
  });

  interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    metadata: {
      sessionId: currentSession.id,
      sessionDirectory: currentSession.directory,
      messageId: message.message_id,
    },
  });
}

export async function handleRenameCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(RENAME_CALLBACK_PREFIX)) {
    return false;
  }

  const state = interactionManager.getSnapshot();
  const metadata = parseRenameMetadata(state);
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === RENAME_CALLBACK_CANCEL) {
      interactionManager.clear("rename_cancelled");
      await ctx.answerCallbackQuery({ text: t("rename.cancelled_callback") });
      await ctx.editMessageText(t("rename.cancelled")).catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  } catch (err) {
    logger.error("[Rename] Error handling callback:", err);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}

export async function handleRenameTextInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const state = interactionManager.getSnapshot();
  const metadata = parseRenameMetadata(state);

  if (!metadata) {
    return false;
  }

  const newTitle = text.trim();

  if (!newTitle) {
    await ctx.reply(t("rename.empty"));
    return true;
  }

  logger.info(`[Rename] Renaming session ${metadata.sessionId} to "${newTitle}"`);

  interactionManager.clear("rename_submitted");

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
  }

  try {
    const { data: updatedSession, error } = await opencodeClient.session.update({
      sessionID: metadata.sessionId,
      directory: metadata.sessionDirectory,
      title: newTitle,
    });

    if (error || !updatedSession) {
      logger.error("[Rename] Failed to rename session:", error);
      await ctx.reply(t("rename.error"));
      return true;
    }

    setCurrentSession({
      id: updatedSession.id,
      title: updatedSession.title,
      directory: metadata.sessionDirectory,
    });

    await ctx.reply(t("rename.success", { newTitle: updatedSession.title }));
  } catch (err) {
    logger.error("[Rename] Error renaming session:", err);
    await ctx.reply(t("rename.error"));
  }

  return true;
}
