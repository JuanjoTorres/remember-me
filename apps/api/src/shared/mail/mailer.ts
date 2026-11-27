export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key, same email: the provider sends it once however often it is submitted. */
  idempotencyKey?: string;
}

/** Outgoing email, as the application needs it. Inject this class, never a driver. */
export abstract class Mailer {
  /** False when messages go nowhere (the `log` driver): jobs that must not lose an email wait. */
  abstract readonly delivers: boolean;
  /** Rejects when the message was not accepted for delivery. */
  abstract send(message: MailMessage): Promise<void>;
}
