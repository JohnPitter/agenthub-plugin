import { Router } from "express";
import { nanoid } from "nanoid";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";
import { getWhatsAppService, resetWhatsAppService } from "../lib/whatsapp-service.js";

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/integrations/whatsapp/status
 * No projectId needed in local mode
 */
router.get("/integrations/whatsapp/status", (_req, res) => {
  try {
    const integration = db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.type, "whatsapp"))
      .get();

    if (!integration) {
      return res.json({ status: "disconnected", integrationId: null });
    }

    const config = integration.config ? JSON.parse(integration.config) : {};

    res.json({
      status: integration.status,
      integrationId: integration.id,
      allowedNumber: config.allowedNumber || null,
    });
  } catch {
    res.json({ status: "disconnected", integrationId: null });
  }
});

/**
 * POST /api/integrations/whatsapp/connect
 * Starts WhatsApp connection — ignores projectId
 */
router.post("/integrations/whatsapp/connect", async (req, res) => {
  try {
    const { allowedNumber } = req.body;
    const configJson = allowedNumber ? JSON.stringify({ allowedNumber }) : null;

    // Get or create integration record
    let integration = db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.type, "whatsapp"))
      .get();

    const now = Date.now();

    if (!integration) {
      const id = nanoid();
      db.insert(schema.integrations)
        .values({ id, type: "whatsapp", status: "connecting", config: configJson, createdAt: now, updatedAt: now })
        .run();
      integration = db.select().from(schema.integrations).where(eq(schema.integrations.id, id)).get();
    } else {
      db.update(schema.integrations)
        .set({ status: "connecting", config: configJson ?? integration.config, updatedAt: now })
        .where(eq(schema.integrations.id, integration.id))
        .run();
    }

    // Reset if previous connection was in error state
    const service = getWhatsAppService();
    if (service.getConnectionStatus() === "error") {
      resetWhatsAppService();
    }

    const whatsapp = getWhatsAppService();
    if (allowedNumber) whatsapp.setAllowedNumber(allowedNumber);

    // Get io from the app for socket events
    const io = req.app.get("io");

    // QR code callback → emit via socket.io
    whatsapp.onQr((qr: string) => {
      io?.emit("integration:status", { type: "whatsapp", status: "connecting", qr });
    });

    // Status change callback → update DB + emit
    whatsapp.onStatusChange((status: string) => {
      if (integration) {
        db.update(schema.integrations)
          .set({ status, updatedAt: Date.now() })
          .where(eq(schema.integrations.id, integration.id))
          .run();
      }
      io?.emit("integration:status", { type: "whatsapp", status });
    });

    // Start connection in background
    whatsapp.connect().catch((err) => {
      console.error("[WhatsApp] Background connect error:", err);
    });

    res.json({
      success: true,
      status: "connecting",
      integrationId: integration?.id,
    });
  } catch (error) {
    console.error("[WhatsApp] Connect error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to connect WhatsApp",
    });
  }
});

/**
 * POST /api/integrations/whatsapp/disconnect
 */
router.post("/integrations/whatsapp/disconnect", async (_req, res) => {
  try {
    const integration = db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.type, "whatsapp"))
      .get();

    // Disconnect service
    try {
      const service = getWhatsAppService();
      await service.disconnect();
    } catch { /* not initialized */ }

    resetWhatsAppService();

    // Update DB
    if (integration) {
      db.update(schema.integrations)
        .set({ status: "disconnected", updatedAt: Date.now() })
        .where(eq(schema.integrations.id, integration.id))
        .run();
    }

    const io = _req.app.get("io");
    io?.emit("integration:status", { type: "whatsapp", status: "disconnected" });

    res.json({ success: true, status: "disconnected" });
  } catch (error) {
    console.error("[WhatsApp] Disconnect error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to disconnect WhatsApp",
    });
  }
});

/**
 * PUT /api/integrations/whatsapp/config
 * Update allowedNumber without reconnecting
 */
router.put("/integrations/whatsapp/config", (req, res) => {
  try {
    const { allowedNumber } = req.body;

    const integration = db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.type, "whatsapp"))
      .get();

    if (!integration) {
      return res.status(404).json({ error: "WhatsApp integration not found" });
    }

    const existingConfig = integration.config ? JSON.parse(integration.config) : {};
    const newConfig = { ...existingConfig, allowedNumber: allowedNumber || undefined };

    db.update(schema.integrations)
      .set({ config: JSON.stringify(newConfig), updatedAt: Date.now() })
      .where(eq(schema.integrations.id, integration.id))
      .run();

    // Update in-memory
    try {
      const service = getWhatsAppService();
      service.setAllowedNumber(allowedNumber || undefined);
    } catch { /* not running */ }

    res.json({ success: true, allowedNumber: allowedNumber || null });
  } catch (error) {
    console.error("[WhatsApp] Config update error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update config",
    });
  }
});

/**
 * Telegram stubs — not implemented in local mode yet
 */
router.get("/integrations/telegram/status", (_req, res) => {
  res.json({ status: "disconnected", integrationId: null });
});
router.post("/integrations/telegram/connect", (_req, res) => {
  res.status(501).json({ error: "Telegram not available in local mode" });
});
router.post("/integrations/telegram/disconnect", (_req, res) => {
  res.json({ success: true, status: "disconnected" });
});

export default router;
