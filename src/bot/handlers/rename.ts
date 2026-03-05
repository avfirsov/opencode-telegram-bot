import { Context } from "grammy";
import { renameManager } from "../../rename/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

function clearRenameInteraction(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "custom") {
    interactionManager.clear(reason);
  }
}

export async function handleRenameTextAnswer(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  if (!renameManager.isWaiting()) {
    logger.debug("[RenameHandler] Not waiting for rename input");
    return;
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    await ctx.reply(t("rename.empty"));
    return;
  }

  const sessionId = renameManager.getSessionId();
  const currentSession = getCurrentSession();

  if (!sessionId || !currentSession || currentSession.id !== sessionId) {
    logger.error("[RenameHandler] Session ID mismatch or session not found");
    renameManager.clear();
    clearRenameInteraction("rename_session_mismatch");
    await ctx.reply(t("rename.error"));
    return;
  }

  logger.info(`[RenameHandler] Renaming session ${sessionId} to: ${trimmedText}`);

  try {
    const { data, error } = await opencodeClient.session.update({
      sessionID: sessionId,
      title: trimmedText,
    });

    if (error || !data) {
      logger.error("[RenameHandler] Failed to rename session:", error);
      await ctx.reply(t("rename.error"));
      return;
    }

    const messageId = renameManager.getMessageId();
    if (messageId !== null && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, messageId).catch(() => {});
    }

    setCurrentSession({
      ...currentSession,
      title: trimmedText,
    });

    renameManager.clear();
    clearRenameInteraction("rename_completed");

    await ctx.reply(t("rename.success", { title: trimmedText }));

    logger.info(`[RenameHandler] Session renamed successfully: ${sessionId}`);
  } catch (error) {
    logger.error("[RenameHandler] Unexpected error:", error);
    await ctx.reply(t("rename.error"));
  }
}

export async function handleRenameCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (!data.startsWith("rename:")) {
    return false;
  }

  logger.debug(`[RenameHandler] Received callback: ${data}`);

  const callbackMessageId = ctx.callbackQuery?.message;
  if (!callbackMessageId || !("message_id" in callbackMessageId)) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  const messageId = callbackMessageId.message_id;
  if (!renameManager.isActiveMessage(messageId)) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  const parts = data.split(":");
  const action = parts[1];

  try {
    switch (action) {
      case "cancel":
        await handleRenameCancel(ctx);
        break;
      default:
        await ctx.answerCallbackQuery({
          text: t("callback.processing_error"),
          show_alert: true,
        });
        break;
    }
  } catch (err) {
    logger.error("[RenameHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("callback.processing_error"),
      show_alert: true,
    });
  }

  return true;
}

async function handleRenameCancel(ctx: Context): Promise<void> {
  renameManager.clear();
  clearRenameInteraction("rename_cancelled");

  await ctx.editMessageText(t("rename.cancelled")).catch(() => {});
  await ctx.answerCallbackQuery();

  logger.info("[RenameHandler] Rename operation cancelled");
}
