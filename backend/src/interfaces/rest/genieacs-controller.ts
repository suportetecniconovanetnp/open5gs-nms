import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { IAuditLogger } from '../../domain/interfaces/audit-logger';

// ─── Bandwidth MHz → LTE resource blocks ────────────────────────────────────
// BaiBLQ_3.x expects integer resource blocks as xsd:int
const BW_MHZ_TO_RB: Record<number, number> = { 5: 25, 10: 50, 15: 75, 20: 100 };
const RB_TO_MHZ: Record<string, string>    = { '25': '5', '50': '10', '75': '15', '100': '20' };

// ─── FAPService base path ────────────────────────────────────────────────────
const FAP = 'Device.Services.FAPService.1.';

// ─── Types ───────────────────────────────────────────────────────────────────
interface BaicellsProvisionInput {
  mcc: string; mnc: string; tac: number; mmeIp: string;
  bandwidthMhz: number; earfcn: number; cellId: number; pci: number; band: number;
}

export interface NbiTask {
  url:  string;
  body: Record<string, any>;
}

// ─── Build the three NBI tasks for a full provision ──────────────────────────
export function buildProvisionTasks(nbiUrl: string, encodedId: string, input: BaicellsProvisionInput): NbiTask[] {
  const plmn    = `${input.mcc}${input.mnc}`;
  const rb      = BW_MHZ_TO_RB[input.bandwidthMhz] ?? 100;
  const taskUrl = `${nbiUrl}/devices/${encodedId}/tasks?timeout=30000&connection_request`;

  const params: Array<[string, string, string]> = [
    // ── User-supplied ────────────────────────────────────────────────────────
    [`${FAP}CellConfig.LTE.EPC.TAC`,                                        String(input.tac),         'xsd:unsignedInt'],
    [`${FAP}CellConfig.LTE.EPC.PLMNList.1.PLMNID`,                          plmn,                      'xsd:string'     ],
    [`${FAP}FAPControl.LTE.Gateway.MmeIpPlmnList`,                          `${input.mmeIp}+${plmn}`,  'xsd:string'     ],
    [`${FAP}FAPControl.LTE.Gateway.S1SigLinkServerList`,                    input.mmeIp,               'xsd:string'     ],
    [`${FAP}FAPControl.LTE.Gateway.ExistPlmnidList`,                        plmn,                      'xsd:string'     ],
    [`${FAP}CellConfig.LTE.RAN.RF.EARFCNDL`,                                String(input.earfcn),      'xsd:int'        ],
    [`${FAP}CellConfig.LTE.RAN.RF.EARFCNUL`,                                String(input.earfcn),      'xsd:int'        ],
    [`${FAP}CellConfig.LTE.RAN.RF.DLBandwidth`,                             String(rb),                'xsd:int'        ],
    [`${FAP}CellConfig.LTE.RAN.RF.ULBandwidth`,                             String(rb),                'xsd:int'        ],
    [`${FAP}CellConfig.LTE.RAN.RF.PhyCellID`,                               String(input.pci),         'xsd:string'     ],
    [`${FAP}CellConfig.LTE.RAN.RF.FreqBandIndicator`,                       String(input.band),        'xsd:unsignedInt'],
    [`${FAP}CellConfig.LTE.RAN.Common.CellIdentity`,                        String(input.cellId),      'xsd:unsignedInt'],
    // ── Hardcoded — required for radio to come up correctly ──────────────────
    // AdminState: BaiBLQ_3.x expects xsd:boolean true/false (maps to 0/1 internally)
    [`${FAP}FAPControl.LTE.AdminState`,                                     'true',  'xsd:boolean'     ],
    [`${FAP}FAPControl.LTE.Gateway.S1SigLinkPort`,                          '36412', 'xsd:unsignedInt' ],
    [`${FAP}FAPControl.LTE.Gateway.S1ConnectionMode`,                       'All',   'xsd:string'      ],
    [`${FAP}FAPControl.X_RADISYS_COM_AUTO_START_ENABLE`,                    '1',     'xsd:unsignedInt' ],
    [`${FAP}CellConfig.LTE.EPC.PLMNList.1.Enable`,                          'true',  'xsd:boolean'     ],
    [`${FAP}CellConfig.LTE.EPC.PLMNList.1.IsPrimary`,                       'true',  'xsd:boolean'     ],
    [`${FAP}CellConfig.LTE.EPC.PLMNList.1.CellReservedForOperatorUse`,      'true',  'xsd:boolean'     ],
    [`${FAP}CellConfig.LTE.RAN.RF.X_COM_RadioEnable`,                       'true',  'xsd:boolean'     ],
    [`${FAP}CellConfig.LTE.RAN.CellRestriction.CellBarred`,                 'true',  'xsd:boolean'     ],
    [`${FAP}CellConfig.LTE.RAN.CellRestriction.CellReservedForOperatorUse`, 'true',  'xsd:boolean'     ],
    [`${FAP}CellConfig.LTE.RAN.PHY.TDDFrame.SubFrameAssignment`,            '2',     'xsd:unsignedInt' ],
    [`${FAP}CellConfig.LTE.RAN.PHY.TDDFrame.SpecialSubframePatterns`,       '5',     'xsd:unsignedInt' ],
    [`${FAP}X_COM.LTE.startPci`,                                            '0',     'xsd:unsignedInt' ],
    [`${FAP}X_COM.LTE.SelfConfig.EARFCNEnable`,                             'false', 'xsd:boolean'     ],
    [`${FAP}X_COM.LTE.SelfConfig.PhyCellIdEnable`,                          'false', 'xsd:boolean'     ],
    ['Device.DeviceInfo.X_COM_GpsSyncEnable',                               'true',  'xsd:boolean'     ],
    ['Device.ManagementServer.PeriodicInformEnable',                        'true',  'xsd:boolean'     ],
    ['Device.ManagementServer.PeriodicInformInterval',                      '5',     'xsd:unsignedInt' ],
  ];

  return [
    { url: taskUrl, body: { name: 'setParameterValues', parameterValues: params } },
    { url: taskUrl, body: { name: 'reboot' } },
    // X_COM_RadioEnable resets to false on every boot — must be re-set after reboot
    {
      url:  taskUrl,
      body: {
        name: 'setParameterValues',
        parameterValues: [[`${FAP}CellConfig.LTE.RAN.RF.X_COM_RadioEnable`, 'true', 'xsd:boolean']],
      },
    },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function encodeDeviceId(deviceId: string): string {
  return encodeURIComponent(deviceId).replace(/%2F/gi, '%252F');
}

function getParam(device: Record<string, any>, dotPath: string): string {
  const parts = dotPath.split('.');
  let node: any = device;
  for (const part of parts) {
    if (node == null) return '';
    node = node[part];
  }
  return node?._value != null ? String(node._value) : '';
}

function toRadio(device: Record<string, any>) {
  const serial     = device._id ?? 'unknown';
  const plmn       = getParam(device, `${FAP}CellConfig.LTE.EPC.PLMNList.1.PLMNID`);
  const mcc        = plmn.length >= 3 ? plmn.slice(0, 3) : '';
  const mnc        = plmn.length >  3 ? plmn.slice(3)    : '';
  const lastInform = device._lastInform ?? null;
  const opState    = getParam(device, `${FAP}FAPControl.LTE.OpState`);
  const rfEnable   = getParam(device, `${FAP}CellConfig.LTE.RAN.RF.X_COM_RadioEnable`);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const isOnline   = lastInform && lastInform > fiveMinAgo;

  const rfStatus: 'on' | 'off' | 'offline' =
    !isOnline                                   ? 'offline' :
    rfEnable === 'true' && opState === 'true'   ? 'on'      : 'off';

  return {
    id:           serial,
    serial,
    lastInform,
    ip:           getParam(device, 'Device.IP.Interface.1.IPv4Address.1.IPAddress'),
    rfStatus,
    mcc,
    mnc,
    tac:          getParam(device, `${FAP}CellConfig.LTE.EPC.TAC`),
    mmeIp:        getParam(device, `${FAP}FAPControl.LTE.Gateway.S1SigLinkServerList`),
    bandwidthMhz: RB_TO_MHZ[getParam(device, `${FAP}CellConfig.LTE.RAN.RF.DLBandwidth`)] ?? '',
    earfcn:       getParam(device, `${FAP}CellConfig.LTE.RAN.RF.EARFCNDL`),
    cellId:       getParam(device, `${FAP}CellConfig.LTE.RAN.Common.CellIdentity`),
    pci:          getParam(device, `${FAP}CellConfig.LTE.RAN.RF.PhyCellID`),
    band:         getParam(device, `${FAP}CellConfig.LTE.RAN.RF.FreqBandIndicator`),
  };
}

async function nbiPost(url: string, body: Record<string, any>): Promise<{ ok: boolean; status: number; text: string }> {
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const text = await resp.text().catch(() => '');
  return { ok: resp.ok, status: resp.status, text };
}

// ─── Radio backup helpers ─────────────────────────────────────────────────────
function radioBackupDir(backupRoot: string, deviceId: string): string {
  const safe = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(backupRoot, 'radio-backups', safe);
}

async function saveRadioBackup(backupRoot: string, deviceId: string, data: Record<string, any>): Promise<string> {
  const dir      = radioBackupDir(backupRoot, deviceId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
  return filename;
}

// ─── Router factory ───────────────────────────────────────────────────────────
export function createGenieacsRouter(
  nbiUrl:      string,
  logger:      pino.Logger,
  auditLogger: IAuditLogger,
  backupRoot:  string,
): Router {
  const router = Router();

  // ── GET /api/genieacs/devices ─────────────────────────────────────────────
  router.get('/devices', async (_req: Request, res: Response) => {
    try {
      const projection = [
        '_id', '_lastInform',
        `${FAP}CellConfig.LTE.EPC.TAC`,
        `${FAP}CellConfig.LTE.EPC.PLMNList.1.PLMNID`,
        `${FAP}FAPControl.LTE.Gateway.S1SigLinkServerList`,
        `${FAP}FAPControl.LTE.OpState`,
        `${FAP}CellConfig.LTE.RAN.RF.EARFCNDL`,
        `${FAP}CellConfig.LTE.RAN.RF.DLBandwidth`,
        `${FAP}CellConfig.LTE.RAN.RF.PhyCellID`,
        `${FAP}CellConfig.LTE.RAN.RF.FreqBandIndicator`,
        `${FAP}CellConfig.LTE.RAN.RF.X_COM_RadioEnable`,
        `${FAP}CellConfig.LTE.RAN.Common.CellIdentity`,
        'Device.IP.Interface.1.IPv4Address.1.IPAddress',
      ].join(',');

      const resp = await fetch(`${nbiUrl}/devices?projection=${encodeURIComponent(projection)}`);
      if (!resp.ok) throw new Error(`GenieACS NBI returned HTTP ${resp.status}`);
      const devices = (await resp.json()) as Record<string, any>[];
      res.json({ success: true, devices: devices.map(toRadio) });
    } catch (err) {
      logger.error({ err: String(err) }, 'Failed to fetch GenieACS devices');
      res.status(502).json({ success: false, error: `GenieACS NBI unreachable: ${String(err)}` });
    }
  });

  // ── POST /api/genieacs/preview/:deviceId ─────────────────────────────────
  // Returns the three NBI task bodies that would be sent — without sending them.
  router.post('/preview/:deviceId', (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const input: BaicellsProvisionInput = req.body;

    const missing = (['mcc','mnc','tac','mmeIp','bandwidthMhz','earfcn','cellId','pci','band'] as const)
      .filter(k => input[k] == null || input[k] === '');
    if (missing.length) {
      return res.status(400).json({ success: false, error: `Missing fields: ${missing.join(', ')}` });
    }

    const encodedId = encodeDeviceId(deviceId);
    const tasks     = buildProvisionTasks(nbiUrl, encodedId, input);
    res.json({ success: true, deviceId, tasks });
  });

  // ── POST /api/genieacs/execute-tasks ─────────────────────────────────────
  // Fires an ordered array of NBI tasks — used by the confirm modal after user review/edit.
  router.post('/execute-tasks', async (req: Request, res: Response) => {
    const { deviceId, tasks } = req.body as { deviceId: string; tasks: NbiTask[] };
    const user = (req as any).user?.username ?? 'unknown';

    if (!deviceId || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ success: false, error: 'deviceId and tasks array required' });
    }

    const results: { task: number; ok: boolean; status: number; response: string }[] = [];

    try {
      for (let i = 0; i < tasks.length; i++) {
        const { url, body } = tasks[i];
        const r = await nbiPost(url, body);
        results.push({ task: i + 1, ok: r.ok, status: r.status, response: r.text });
        if (!r.ok) throw new Error(`Task ${i + 1} failed (${r.status}): ${r.text}`);
      }

      await auditLogger.log({
        action:  'radio_provision',
        user,
        target:  deviceId,
        details: `Executed ${tasks.length} NBI tasks via confirm modal`,
        success: true,
      });

      // Auto-backup after successful provision
      try {
        const backupResp = await fetch(`${nbiUrl}/devices?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`)
        if (backupResp.ok) {
          const devices = (await backupResp.json()) as Record<string, any>[];
          if (devices && devices.length > 0) {
            await saveRadioBackup(backupRoot, deviceId, devices[0]);
          }
        }
      } catch (backupErr) {
        logger.warn({ backupErr: String(backupErr), deviceId }, 'Auto-backup after provision failed');
      }

      res.json({ success: true, results });
    } catch (err) {
      await auditLogger.log({
        action:  'radio_provision',
        user,
        target:  deviceId,
        details: String(err),
        success: false,
      });
      res.status(502).json({ success: false, error: String(err), results });
    }
  });

  // ── POST /api/genieacs/refresh/:deviceId ─────────────────────────────────
  router.post('/refresh/:deviceId', async (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const encodedId    = encodeDeviceId(deviceId);
    const taskUrl      = `${nbiUrl}/devices/${encodedId}/tasks?connection_request`;

    try {
      const r = await nbiPost(taskUrl, {
        name: 'getParameterValues',
        parameterNames: ['Device.DeviceInfo.SoftwareVersion'],
      });
      if (!r.ok) throw new Error(`connection_request failed (${r.status}): ${r.text}`);
      res.json({ success: true, message: 'Connection request sent — device will inform shortly.' });
    } catch (err) {
      logger.error({ deviceId, err: String(err) }, 'Force refresh failed');
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  // ── POST /api/genieacs/reboot/:deviceId ──────────────────────────────────
  router.post('/reboot/:deviceId', async (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const user         = (req as any).user?.username ?? 'unknown';
    const encodedId    = encodeDeviceId(deviceId);
    const taskUrl      = `${nbiUrl}/devices/${encodedId}/tasks?timeout=30000&connection_request`;

    logger.info({ deviceId }, 'Rebooting radio');

    try {
      const r = await nbiPost(taskUrl, { name: 'reboot' });
      if (!r.ok) throw new Error(`Reboot failed (${r.status}): ${r.text}`);
      await auditLogger.log({ action: 'radio_reboot', user, target: deviceId, details: 'Single radio reboot', success: true });
      res.json({ success: true, message: 'Reboot task queued.' });
    } catch (err) {
      await auditLogger.log({ action: 'radio_reboot', user, target: deviceId, details: String(err), success: false });
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  // ── POST /api/genieacs/reboot-all ────────────────────────────────────────
  router.post('/reboot-all', async (req: Request, res: Response) => {
    const user = (req as any).user?.username ?? 'unknown';

    try {
      const listResp = await fetch(`${nbiUrl}/devices?projection=_id`);
      if (!listResp.ok) throw new Error(`Failed to list devices: ${listResp.status}`);
      const devices = (await listResp.json()) as Record<string, any>[];

      const results = await Promise.allSettled(
        devices.map(async (d) => {
          const id        = d._id as string;
          const encodedId = encodeDeviceId(id);
          const taskUrl   = `${nbiUrl}/devices/${encodedId}/tasks?timeout=30000&connection_request`;
          const r         = await nbiPost(taskUrl, { name: 'reboot' });
          if (!r.ok) throw new Error(`${id}: reboot failed (${r.status})`);
          return id;
        }),
      );

      const failed  = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason);
      const success = failed.length === 0;

      await auditLogger.log({
        action:  'radio_reboot_all',
        user,
        details: `Rebooted ${devices.length} radios. Failures: ${failed.length}`,
        success,
      });

      res.json({ success, rebooted: devices.length, failures: failed });
    } catch (err) {
      await auditLogger.log({ action: 'radio_reboot_all', user, details: String(err), success: false });
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  // ── POST /api/genieacs/rf/:deviceId ──────────────────────────────────────
  router.post('/rf/:deviceId', async (req: Request, res: Response) => {
    const { deviceId }       = req.params;
    const { enable }         = req.body as { enable: boolean };
    const user               = (req as any).user?.username ?? 'unknown';
    const encodedId          = encodeDeviceId(deviceId);
    const taskUrl            = `${nbiUrl}/devices/${encodedId}/tasks?timeout=30000&connection_request`;
    const action             = enable ? 'radio_rf_enable' : 'radio_rf_disable';

    logger.info({ deviceId, enable }, 'Setting RF on radio');

    try {
      const r = await nbiPost(taskUrl, {
        name: 'setParameterValues',
        parameterValues: [[`${FAP}CellConfig.LTE.RAN.RF.X_COM_RadioEnable`, String(enable), 'xsd:boolean']],
      });
      if (!r.ok) throw new Error(`RF set failed (${r.status}): ${r.text}`);
      await auditLogger.log({ action, user, target: deviceId, details: `RF ${enable ? 'enabled' : 'disabled'}`, success: true });
      res.json({ success: true, message: `RF ${enable ? 'enabled' : 'disabled'}.` });
    } catch (err) {
      await auditLogger.log({ action, user, target: deviceId, details: String(err), success: false });
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  // ── POST /api/genieacs/rf-all ─────────────────────────────────────────────
  router.post('/rf-all', async (req: Request, res: Response) => {
    const { enable } = req.body as { enable: boolean };
    const user       = (req as any).user?.username ?? 'unknown';

    try {
      const listResp = await fetch(`${nbiUrl}/devices?projection=_id`);
      if (!listResp.ok) throw new Error(`Failed to list devices: ${listResp.status}`);
      const devices = (await listResp.json()) as Record<string, any>[];

      const results = await Promise.allSettled(
        devices.map(async (d) => {
          const id        = d._id as string;
          const encodedId = encodeDeviceId(id);
          const taskUrl   = `${nbiUrl}/devices/${encodedId}/tasks?timeout=30000&connection_request`;
          const r         = await nbiPost(taskUrl, {
            name: 'setParameterValues',
            parameterValues: [[`${FAP}CellConfig.LTE.RAN.RF.X_COM_RadioEnable`, String(enable), 'xsd:boolean']],
          });
          if (!r.ok) throw new Error(`${id}: RF set failed (${r.status})`);
          return id;
        }),
      );

      const failed  = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason);
      const success = failed.length === 0;

      await auditLogger.log({
        action:  'radio_rf_all',
        user,
        details: `RF ${enable ? 'enabled' : 'disabled'} on ${devices.length} radios. Failures: ${failed.length}`,
        success,
      });

      res.json({ success, affected: devices.length, failures: failed });
    } catch (err) {
      await auditLogger.log({ action: 'radio_rf_all', user, details: String(err), success: false });
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  // ── GET /api/genieacs/backups/:deviceId ───────────────────────────────────
  router.get('/backups/:deviceId', (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const dir          = radioBackupDir(backupRoot, deviceId);

    try {
      if (!fs.existsSync(dir)) return res.json({ success: true, backups: [] });
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .map(f => ({ filename: f, deviceId }));
      res.json({ success: true, backups: files });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── GET /api/genieacs/backups/:deviceId/:filename ─────────────────────────
  router.get('/backups/:deviceId/:filename', (req: Request, res: Response) => {
    const { deviceId, filename } = req.params;
    if (!filename.endsWith('.json') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    const filePath = path.join(radioBackupDir(backupRoot, deviceId), filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Backup not found' });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  });

  // ── POST /api/genieacs/backup/:deviceId ───────────────────────────────────
  router.post('/backup/:deviceId', async (req: Request, res: Response) => {
    const { deviceId } = req.params;
    try {
      // Use the NBI devices list with a query filter to avoid ID encoding issues
      const resp = await fetch(`${nbiUrl}/devices?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`)
      if (!resp.ok) throw new Error(`NBI returned ${resp.status}`);
      const devices = (await resp.json()) as Record<string, any>[];
      if (!devices || devices.length === 0) throw new Error(`Device not found: ${deviceId}`);
      const filename = await saveRadioBackup(backupRoot, deviceId, devices[0]);
      res.json({ success: true, filename });
    } catch (err) {
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  return router;
}
