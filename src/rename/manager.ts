import { logger } from "../utils/logger.js";

interface RenameState {
  isWaiting: boolean;
  sessionId: string | null;
  messageId: number | null;
}

class RenameManager {
  private state: RenameState = {
    isWaiting: false,
    sessionId: null,
    messageId: null,
  };

  start(sessionId: string, messageId: number): void {
    logger.info(
      `[RenameManager] Starting rename operation: sessionId=${sessionId}, messageId=${messageId}`,
    );

    this.state = {
      isWaiting: true,
      sessionId,
      messageId,
    };
  }

  clear(): void {
    logger.info("[RenameManager] Clearing rename state");
    this.state = {
      isWaiting: false,
      sessionId: null,
      messageId: null,
    };
  }

  isWaiting(): boolean {
    return this.state.isWaiting;
  }

  getSessionId(): string | null {
    return this.state.sessionId;
  }

  getMessageId(): number | null {
    return this.state.messageId;
  }

  isActiveMessage(messageId: number | null): boolean {
    return (
      this.state.isWaiting && this.state.messageId !== null && messageId === this.state.messageId
    );
  }
}

export const renameManager = new RenameManager();
