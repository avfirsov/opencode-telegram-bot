import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const RENAME_CALLBACK_PREFIX = "rename:";
const RENAME_CALLBACK_CANCEL = `${RENAME_CALLBACK_PREFIX}cancel`;

interface RenameMetadata {
  flow: "rename";
  messageId: number;
  sessionId: string;
  directory: string;
}

function parseRenameMetadata(state: InteractionState | null): RenameMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const { flow, messageId, sessionId, directory } = state.metadata;

  if (
    flow !== "rename" ||
    typeof messageId !== "number" ||
    typeof sessionId !== "string" ||
    typeof directory !== "string"
  ) {
    return null;
  }

  return { flow: "rename", messageId, sessionId, directory };
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function clearRenameInteraction(reason: string): void {
  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

function buildRenameCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("rename.button.cancel"), RENAME_CALLBACK_CANCEL);
}

export async function renameCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentSession = getCurrentSession();
    if (!currentSession) {
      await ctx.reply(t("rename.no_active_session"));
      return;
    }

    const keyboard = buildRenameCancelKeyboard();
    const message = await ctx.reply(t("rename.prompt", { title: currentSession.title }), {
      reply_markup: keyboard,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "rename",
        messageId: message.message_id,
        sessionId: currentSession.id,
        directory: currentSession.directory,
      },
    });

    logger.debug(
      `[Rename] Started rename flow: sessionId=${currentSession.id}, messageId=${message.message_id}`,
    );
  } catch (error) {
    logger.error("[Rename] Error starting rename flow:", error);
    await ctx.reply(t("rename.error"));
  }
}

export async function handleRenameCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(RENAME_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === RENAME_CALLBACK_CANCEL) {
      clearRenameInteraction("rename_cancelled");
      await ctx.answerCallbackQuery({ text: t("rename.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery();
    return true;
  } catch (error) {
    logger.error("[Rename] Error handling rename callback:", error);
    clearRenameInteraction("rename_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
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

  try {
    const { error } = await opencodeClient.session.update({
      sessionID: metadata.sessionId,
      directory: metadata.directory,
      title: newTitle,
    });

    if (error) {
      logger.error("[Rename] OpenCode API returned an error for session.update:", error);
      clearRenameInteraction("rename_api_error");
      await ctx.reply(t("rename.error"));
      return true;
    }

    // Update local session state with new title
    const currentSession = getCurrentSession();
    if (currentSession && currentSession.id === metadata.sessionId) {
      setCurrentSession({
        ...currentSession,
        title: newTitle,
      });
    }

    clearRenameInteraction("rename_success");

    // Delete the prompt message
    if (ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
    }

    await ctx.reply(t("rename.success", { title: newTitle }));

    logger.info(
      `[Rename] Session renamed: sessionId=${metadata.sessionId}, newTitle="${newTitle}"`,
    );
  } catch (error) {
    logger.error("[Rename] Error renaming session:", error);
    clearRenameInteraction("rename_error");
    await ctx.reply(t("rename.error"));
  }

  return true;
}
