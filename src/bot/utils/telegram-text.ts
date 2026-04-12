import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";
import {
  editMessageWithMarkdownFallback,
  isTelegramMarkdownParseError,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import type { TelegramRenderedPart } from "../../telegram/render/types.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type TelegramTextFormat = "raw" | "markdown_v2";

interface SendBotTextParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  format?: TelegramTextFormat;
}

interface SendRenderedBotPartParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  part: TelegramRenderedPart;
  options?: TelegramSendMessageOptions;
}

function resolveParseMode(format: TelegramTextFormat | undefined): "MarkdownV2" | undefined {
  if (format === "markdown_v2") {
    return "MarkdownV2";
  }

  return undefined;
}

function stripRichFormattingOptions<T extends TelegramSendMessageOptions | undefined>(
  options: T,
): T {
  if (!options) {
    return options;
  }

  const rawOptions = {
    ...options,
  } as NonNullable<T> & {
    parse_mode?: unknown;
    entities?: unknown;
  };

  delete rawOptions.parse_mode;
  delete rawOptions.entities;

  return rawOptions as T;
}

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: SendBotTextParams): Promise<void> {
  await sendMessageWithMarkdownFallback({
    api,
    chatId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveParseMode(format),
  });
}

export async function sendRenderedBotPart({
  api,
  chatId,
  part,
  options,
}: SendRenderedBotPartParams): Promise<void> {
  const rawOptions = stripRichFormattingOptions(options);

  if (!part.entities?.length) {
    await api.sendMessage(chatId, part.text, rawOptions);
    return;
  }

  try {
    await api.sendMessage(chatId, part.text, {
      ...(rawOptions || {}),
      entities: part.entities,
    });
  } catch (error) {
    if (!isTelegramMarkdownParseError(error)) {
      throw error;
    }

    logger.warn(
      "[Bot] Entity payload rejected, retrying assistant message part in raw mode",
      error,
    );
    await api.sendMessage(chatId, part.fallbackText, rawOptions);
  }
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: EditBotTextParams): Promise<void> {
  await editMessageWithMarkdownFallback({
    api,
    chatId,
    messageId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveParseMode(format),
  });
}
