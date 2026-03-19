import wppconnect from "@wppconnect-team/wppconnect";
import type { Whatsapp } from "@wppconnect-team/wppconnect";
import { join } from "path";
import { existsSync, readdirSync, unlinkSync } from "fs";
import { DATA_DIR } from "../db.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** Safely extract a serialized WID string from any value */
function serializeWid(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return value.includes("@") ? value : `${value.replace(/\D/g, "")}@c.us`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj._serialized === "string" && obj._serialized) return obj._serialized;
    if (typeof obj.user === "string" && typeof obj.server === "string") return `${obj.user}@${obj.server}`;
  }
  return null;
}

export class WhatsAppService {
  private client: Whatsapp | null = null;
  private status: ConnectionStatus = "disconnected";
  private allowedNumber: string | null = null;
  private qrCallback: ((qr: string) => void) | null = null;
  private statusCallback: ((status: ConnectionStatus) => void) | null = null;
  private isConnecting = false;

  private readonly tokenDir = join(DATA_DIR, "whatsapp-tokens");

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  setAllowedNumber(num: string | undefined) {
    this.allowedNumber = num || null;
  }

  onQr(cb: (qr: string) => void) {
    this.qrCallback = cb;
  }

  onStatusChange(cb: (status: ConnectionStatus) => void) {
    this.statusCallback = cb;
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.statusCallback?.(s);
  }

  /** Remove Chromium singleton locks that prevent reconnection */
  private cleanSingletonLocks() {
    const chromiumDataDir = join(this.tokenDir, "session-local");
    if (!existsSync(chromiumDataDir)) return;
    try {
      for (const entry of readdirSync(chromiumDataDir)) {
        if (entry.startsWith("Singleton")) {
          try { unlinkSync(join(chromiumDataDir, entry)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  async connect(): Promise<void> {
    if (this.isConnecting || this.status === "connected") return;
    this.isConnecting = true;
    this.setStatus("connecting");

    this.cleanSingletonLocks();

    try {
      const client = await wppconnect.create({
        session: "local",
        folderNameToken: this.tokenDir,
        headless: true,
        autoClose: 0,
        puppeteerOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        },
        catchQR: (base64Qr: string) => {
          this.qrCallback?.(base64Qr);
        },
        statusFind: (statusSession: string) => {
          console.log(`[WhatsApp] Session status: ${statusSession}`);
          if (statusSession === "isLogged" || statusSession === "inChat") {
            this.setStatus("connected");
          }
        },
        logQR: false,
      });

      this.client = client;
      this.setStatus("connected");

      // Listen for incoming messages
      client.onMessage((msg) => {
        const from = serializeWid(msg.from);
        if (!from || from.endsWith("@g.us")) return; // ignore groups

        // Filter by allowed number if configured
        if (this.allowedNumber) {
          const normalized = this.allowedNumber.replace(/\D/g, "");
          if (!from.includes(normalized)) return;
        }

        console.log(`[WhatsApp] Message from ${from}: ${msg.body?.slice(0, 100)}`);
      });

    } catch (err) {
      console.error("[WhatsApp] Connection failed:", err);
      this.setStatus("error");
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch { /* ignore */ }
      this.client = null;
    }
    this.setStatus("disconnected");
  }
}

// Singleton
let instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!instance) {
    instance = new WhatsAppService();
  }
  return instance;
}

export function resetWhatsAppService() {
  instance = null;
}
