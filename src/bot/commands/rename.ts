import { CommandContext, Context, InlineKeyboard } from "grammy";
import { getCurrentSession } from "../../session/manager.js";
import { renameManager } from "../../rename/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export async function renameCommand(ctx: CommandContext<Context>) {
  try {
    const currentSession = getCurrentSession();

    if (!currentSession) {
      await ctx.reply(t("rename.no_session"));
      return;
    }

    const keyboard = new InlineKeyboard().text(t("rename.cancel"), "rename:cancel");

    const message = await ctx.reply(t("rename.prompt"), {
      reply_markup: keyboard,
    });

    renameManager.start(currentSession.id, message.message_id);

    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        sessionId: currentSession.id,
        messageId: message.message_id,
      },
    });

    logger.info(`[Rename] Started rename operation for session: ${currentSession.id}`);
  } catch (error) {
    logger.error("[Rename] Error starting rename operation:", error);
    await ctx.reply(t("rename.error"));
  }
}
