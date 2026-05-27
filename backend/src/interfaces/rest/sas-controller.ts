import { Router, Request, Response } from 'express';
import pino from 'pino';
import { SasService } from '../../domain/sas/sas-service';
import {
  RegistrationRequest, SpectrumInquiryRequest,
  GrantRequest, HeartbeatRequest,
  RelinquishmentRequest, DeregistrationRequest,
} from '../../domain/sas/sas-types';

export function createSasRouter(sas: SasService, logger: pino.Logger): Router {
  const router = Router();

  // ── POST /sas/v1.2/registration ──────────────────────────────────────────
  router.post('/v1.2/registration', async (req: Request, res: Response) => {
    if (sas.isPaused()) return res.json({ registrationResponse: [{ response: { responseCode: 105, responseMessage: 'DEREGISTER' } }] });
    logger.info({ body: req.body, ip: req.ip, headers: req.headers }, 'SAS registration request');
    try {
      const requests: RegistrationRequest[] = req.body?.registrationRequest;
      if (!Array.isArray(requests) || requests.length === 0) {
        logger.warn({ body: req.body }, 'SAS registration: missing registrationRequest array');
        return res.status(400).json({ registrationResponse: [] });
      }
      const registrationResponse = await sas.registration(requests);
      logger.info({ registrationResponse }, 'SAS registration response');
      res.json({ registrationResponse });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS registration error');
      res.status(500).json({ registrationResponse: [] });
    }
  });

  // ── POST /sas/v1.2/spectrumInquiry ───────────────────────────────────────
  router.post('/v1.2/spectrumInquiry', async (req: Request, res: Response) => {
    if (sas.isPaused()) return res.json({ spectrumInquiryResponse: [{ response: { responseCode: 105, responseMessage: 'DEREGISTER' } }] });
    logger.info({ body: req.body, ip: req.ip }, 'SAS spectrumInquiry request');
    try {
      const requests: SpectrumInquiryRequest[] = req.body?.spectrumInquiryRequest;
      if (!Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({ spectrumInquiryResponse: [] });
      }
      const spectrumInquiryResponse = await sas.spectrumInquiry(requests);
      logger.info({ spectrumInquiryResponse }, 'SAS spectrumInquiry response');
      res.json({ spectrumInquiryResponse });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS spectrumInquiry error');
      res.status(500).json({ spectrumInquiryResponse: [] });
    }
  });

  // ── POST /sas/v1.2/grant ─────────────────────────────────────────────────
  router.post('/v1.2/grant', async (req: Request, res: Response) => {
    if (sas.isPaused()) return res.json({ grantResponse: [{ response: { responseCode: 105, responseMessage: 'DEREGISTER' } }] });
    try {
      const requests: GrantRequest[] = req.body?.grantRequest;
      logger.info({ RAW_REQUEST: req.body, ip: req.ip }, 'SAS /grant RAW');
      if (!Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({ grantResponse: [] });
      }
      const grantResponse = await sas.grant(requests);
      logger.info({ RAW_RESPONSE: { grantResponse } }, 'SAS /grant RAW response');
      res.json({ grantResponse });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS grant error');
      res.status(500).json({ grantResponse: [] });
    }
  });

  // ── POST /sas/v1.2/heartbeat ─────────────────────────────────────────────
  router.post('/v1.2/heartbeat', async (req: Request, res: Response) => {
    if (sas.isPaused()) return res.json({ heartbeatResponse: [{ transmitExpireTime: new Date().toISOString(), response: { responseCode: 500, responseMessage: 'TERMINATED_GRANT' } }] });
    try {
      const requests: HeartbeatRequest[] = req.body?.heartbeatRequest;
      logger.info({ RAW_REQUEST: req.body, ip: req.ip }, 'SAS /heartbeat RAW');
      if (!Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({ heartbeatResponse: [] });
      }
      const heartbeatResponse = await sas.heartbeat(requests);
      logger.info({ RAW_RESPONSE: { heartbeatResponse } }, 'SAS /heartbeat RAW response');
      res.json({ heartbeatResponse });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS heartbeat error');
      res.status(500).json({ heartbeatResponse: [] });
    }
  });

  // ── POST /sas/v1.2/relinquishment ────────────────────────────────────────
  router.post('/v1.2/relinquishment', async (req: Request, res: Response) => {
    logger.info({ body: req.body, ip: req.ip }, 'SAS relinquishment request');
    try {
      const requests: RelinquishmentRequest[] = req.body?.relinquishmentRequest;
      if (!Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({ relinquishmentResponse: [] });
      }
      const relinquishmentResponse = await sas.relinquishment(requests);
      logger.info({ relinquishmentResponse }, 'SAS relinquishment response');
      res.json({ relinquishmentResponse });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS relinquishment error');
      res.status(500).json({ relinquishmentResponse: [] });
    }
  });

  // ── POST /sas/v1.2/deregistration ────────────────────────────────────────
  router.post('/v1.2/deregistration', async (req: Request, res: Response) => {
    logger.info({ body: req.body, ip: req.ip }, 'SAS deregistration request');
    try {
      const requests: DeregistrationRequest[] = req.body?.deregistrationRequest;
      if (!Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({ deregistrationResponse: [] });
      }
      const deregistrationResponse = await sas.deregistration(requests);
      logger.info({ deregistrationResponse }, 'SAS deregistration response');
      res.json({ deregistrationResponse });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS deregistration error');
      res.status(500).json({ deregistrationResponse: [] });
    }
  });

  // ── GET /sas/admin/logs ───────────────────────────────────────────────────
  // Merges nginx SAS access log + backend structured SAS logs into one stream
  router.get('/admin/logs', async (req: Request, res: Response) => {
    const lines = Math.min(parseInt(req.query.lines as string ?? '200', 10), 2000);
    try {
      const { spawn }  = await import('child_process');
      const { promises: fs } = await import('fs');

      // 1 — Nginx SAS access log (mounted at /var/log/nginx-sas/sas-access.log)
      let nginxLines: string[] = [];
      try {
        const raw = await fs.readFile('/var/log/nginx-sas/sas-access.log', 'utf8');
        nginxLines = raw.split('\n')
          .filter(l => l.trim())
          .slice(-lines)
          .map(l => `[NGINX] ${l}`);
      } catch { /* file may not exist yet */ }

      // 2 — Backend structured SAS logs from docker
      const dockerRaw = await new Promise<string>((resolve) => {
        const args = ['logs', '--timestamps', '--tail', String(lines * 4), 'open5gs-nms-backend'];
        const proc = spawn('docker', args);
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
      });

      const backendLines = dockerRaw
        .split('\n')
        .filter(l => /SAS|sas\/v1\.2|registrationRequest|grantRequest|heartbeatRequest|spectrumInquiry|relinquishment|deregistration/i.test(l))
        .slice(-lines)
        .map(l => `[BACKEND] ${l}`);

      // 3 — Merge and sort by timestamp (both start with ISO timestamp)
      const merged = [...nginxLines, ...backendLines]
        .sort((a, b) => {
          const ta = a.match(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/);
          const tb = b.match(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/);
          if (!ta || !tb) return 0;
          return ta[0].localeCompare(tb[0]);
        })
        .slice(-lines)
        .join('\n');

      res.json({ success: true, logs: merged });
    } catch (err) {
      logger.error({ err: String(err) }, 'SAS log fetch failed');
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── DELETE /sas/admin/grants/:grantId ─────────────────────────────────────
  router.delete('/admin/grants/:grantId', async (req: Request, res: Response) => {
    try {
      const deleted = await sas.deleteGrant(req.params.grantId);
      if (!deleted) return res.status(404).json({ success: false, error: 'Grant not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── DELETE /sas/admin/cbsds/:cbsdId ─────────────────────────────────────
  router.delete('/admin/cbsds/:cbsdId', async (req: Request, res: Response) => {
    try {
      const deleted = await sas.deleteCbsd(req.params.cbsdId);
      if (!deleted) return res.status(404).json({ success: false, error: 'CBSD not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── GET /sas/admin/cbsds ─────────────────────────────────────────────────
  router.get('/admin/cbsds', async (_req: Request, res: Response) => {
    try {
      const cbsds  = await sas.listCbsds();
      const grants = await sas.listGrants();
      // Attach grants to each CBSD
      const grantsByCbsd = grants.reduce((acc, g) => {
        (acc[g.cbsdId] ??= []).push(g);
        return acc;
      }, {} as Record<string, typeof grants>);
      const data = cbsds.map(c => ({ ...c, grants: grantsByCbsd[c.cbsdId] ?? [] }));
      res.json({ success: true, cbsds: data });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── GET /sas/admin/stats ──────────────────────────────────────────────────
  router.get('/admin/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await sas.getStats();
      res.json({ success: true, ...stats });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── GET /sas/admin/config ─────────────────────────────────────────────────
  router.get('/admin/config', async (_req: Request, res: Response) => {
    try {
      const config = await sas.getConfig();
      res.json({ success: true, config });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── PUT /sas/admin/config ─────────────────────────────────────────────────
  router.put('/admin/config', async (req: Request, res: Response) => {
    try {
      const config = await sas.updateConfig(req.body);
      res.json({ success: true, config });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── POST /sas/admin/reset ────────────────────────────────────────────
  // Deletes all grants + CBSDs. Does NOT touch radios or ACS.
  router.post('/admin/reset', async (_req: Request, res: Response) => {
    try {
      const result = await sas.resetAll();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── POST /sas/admin/pause ────────────────────────────────────────────
  // Pauses the SAS — all protocol endpoints return DEREGISTER/TERMINATED.
  // Radios stop transmitting and wait. No data is deleted.
  router.post('/admin/pause', (_req: Request, res: Response) => {
    sas.pauseSas();
    res.json({ success: true, paused: true });
  });

  // ── POST /sas/admin/resume ───────────────────────────────────────────
  router.post('/admin/resume', (_req: Request, res: Response) => {
    sas.resumeSas();
    res.json({ success: true, paused: false });
  });

  // ── GET /sas/admin/status ────────────────────────────────────────────
  router.get('/admin/status', (_req: Request, res: Response) => {
    res.json({ success: true, paused: sas.isPaused() });
  });

  // ── GET /sas/admin/slots ─────────────────────────────────────────────
  router.get('/admin/slots', async (_req: Request, res: Response) => {
    try {
      const layout = await sas.getSlotLayout();
      res.json({ success: true, ...layout });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  return router;
}
