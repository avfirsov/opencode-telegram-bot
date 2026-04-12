import type { TelegramBlock, TelegramRenderedBlock } from "./types.js";
import * as blockRenderer from "./block-renderer.js";

const BLOCK_RENDER_ORDER = ["full", "simplified", "line-by-line", "plain"] as const;

export function renderTelegramBlockWithFallback(block: TelegramBlock): TelegramRenderedBlock {
  let lastError: unknown;

  for (const mode of BLOCK_RENDER_ORDER) {
    try {
      return blockRenderer.renderTelegramBlock(block, mode);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to render Telegram block");
}
