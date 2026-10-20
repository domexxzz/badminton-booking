/** Provider-neutral facts read from a bank slip. */
export type SlipFacts = {
  transRef: string;
  amount: number; // THB, may have satang
  date: string; // ISO 8601 with offset
  sender?: {
    name: string | null;
  };
  receiver: {
    names: string[]; // Thai and/or English; banks often truncate them
    bankAccount: string | null; // usually masked, e.g. "xxx-x-x5678-x"
    proxyType: string | null; // MSISDN, NATID, EWALLETID, ...
    proxyAccount: string | null; // PromptPay ID, usually masked
  };
};

export type ProviderResult =
  | { kind: "ok"; slip: SlipFacts; raw: unknown }
  /** The image is not a verifiable slip (no QR, fake, unreadable). */
  | { kind: "unreadable"; message: string }
  /** We could not get an answer (network, quota, bank delay). */
  | { kind: "error"; message: string };

/** Outcomes the server reports; the database adds "duplicate" itself. */
export type VerifyStatus = "verified" | "mismatch" | "unreadable" | "error";
