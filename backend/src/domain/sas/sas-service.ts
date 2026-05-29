import { v4 as uuidv4 } from 'uuid';
import { Collection, MongoClient } from 'mongodb';
import pino from 'pino';
import {
  SasCbsd, SasGrant, SasConfig, SasFrequencyBand,
  RegistrationRequest, RegistrationResponse,
  SpectrumInquiryRequest, SpectrumInquiryResponse, AvailableChannel,
  GrantRequest, GrantResponse,
  HeartbeatRequest, HeartbeatResponse,
  RelinquishmentRequest, RelinquishmentResponse,
  DeregistrationRequest, DeregistrationResponse,
  RC, makeResponse, sasFmt,
  GroupBandPolicy, CbsdBandPolicy,
} from './sas-types';

// ─── Band 48 EARFCN helpers (3GPP TS 36.101) ────────────────────────────────
// F_MHz = 3550 + 0.1 × (EARFCN - 55240)
// EARFCN = 55240 + 10 × (F_MHz - 3550)
// EARFCN range: 55240 (3550 MHz) to 56739 (3699.9 MHz)
function earfcnToMhz(earfcn: number): number {
  return 3550 + 0.1 * (earfcn - 55240);
}
function earfcnToHz(earfcn: number): number {
  return Math.round(earfcnToMhz(earfcn) * 1e6);
}

const CBRS_LOW  = 3_550_000_000;  // EARFCN 55240
const CBRS_HIGH = 3_700_000_000;  // EARFCN 56740

export class SasService {
  private cbsds!:        Collection<SasCbsd>;
  private grants!:        Collection<SasGrant>;
  private configs!:       Collection<SasConfig>;
  private groupPolicies!: Collection<GroupBandPolicy>;
  private cbsdPolicies!:  Collection<CbsdBandPolicy>;
  private ready = false;

  constructor(
    private readonly mongoUri: string,
    private readonly logger:   pino.Logger,
  ) {}

  async initialize(): Promise<void> {
    const client = new MongoClient(this.mongoUri);
    await client.connect();
    const db = client.db('open5gs');
    this.cbsds        = db.collection<SasCbsd>('sas_cbsds');
    this.grants        = db.collection<SasGrant>('sas_grants');
    this.configs       = db.collection<SasConfig>('sas_configs');
    this.groupPolicies = db.collection<GroupBandPolicy>('sas_group_policies');
    this.cbsdPolicies  = db.collection<CbsdBandPolicy>('sas_cbsd_policies');

    await this.cbsds.createIndex({ cbsdId: 1 },                     { unique: true });
    await this.cbsds.createIndex({ cbsdSerialNumber: 1, fccId: 1 });
    await this.grants.createIndex({ grantId: 1 },                   { unique: true });
    await this.grants.createIndex({ cbsdId: 1 });
    await this.grants.createIndex({ grantExpireTime: 1 });

    const existing = await this.configs.findOne({ _id: 'sas_config' });
    if (!existing) {
      await this.configs.insertOne({
        _id:                      'sas_config',
        allowedBandLow:           CBRS_LOW,
        allowedBandHigh:          CBRS_HIGH,
        maxEirpGAA:               30,
        heartbeatInterval:        240,
        grantExpireHours:         24,
        defaultGrantBandwidthMhz: 20,
        autoApprove:              true,
        frequencyBands: [
          {
            // Full CBRS band: EARFCN 55240 (3550 MHz) to 56739 (3699.9 MHz)
            id:              uuidv4(),
            label:           'Full CBRS Band (fallback)',
            lowFrequency:    earfcnToHz(55240),  // 3550 MHz
            highFrequency:   earfcnToHz(56739),  // 3699.9 MHz
            maxBandwidthMhz: 20,
          },
          {
            // Baicells valid EARFCN range: 55340 (3560 MHz) to 56640 (3690 MHz)
            id:              uuidv4(),
            label:           'Baicells (EARFCN 55340–56640)',
            lowFrequency:    earfcnToHz(55340),  // 3560 MHz
            highFrequency:   earfcnToHz(56640),  // 3690 MHz
            maxBandwidthMhz: 20,
          },
        ],
        updatedAt:                new Date(),
      });
    }

    this.ready = true;
    this.logger.info('SAS service initialized');
  }

  // ─── Channel slot assignment ──────────────────────────────────────────────
  // Divides the configured band into equal slots and assigns each CBSD a unique
  // non-overlapping slot within its interference coordination group.
  // Radios in the same groupId never share a slot — prevents co-site interference.
  private computeSlots(band: SasFrequencyBand, slotWidthHz: number): Array<{ low: number; high: number }> {
    const slots: Array<{ low: number; high: number }> = [];
    let cursor = band.lowFrequency;
    while (cursor + slotWidthHz <= band.highFrequency + 1) {
      slots.push({ low: cursor, high: cursor + slotWidthHz });
      cursor += slotWidthHz;
    }
    return slots;
  }

  private async assignChannelSlot(
    cbsdId:    string,
    groupId:   string | undefined,
    band:      SasFrequencyBand,
    slotWidthHz: number,
  ): Promise<{ low: number; high: number }> {
    const slots = this.computeSlots(band, slotWidthHz);
    if (slots.length === 0) return { low: band.lowFrequency, high: band.highFrequency };
    if (slots.length === 1) return slots[0];

    // Deterministic slot assignment — sort all registered CBSDs in the same
    // interference coordination group by serial number (cbsdSerialNumber).
    // Serial never changes across re-registrations, so slot assignment is
    // stable even after Clear DB + reboot cycles.
    const allCbsds = await this.cbsds.find({ state: 'REGISTERED' }).toArray();

    const groupCbsds = groupId
      ? allCbsds.filter(c =>
          c.groupingParam?.some(
            p => p.groupType === 'INTERFERENCE_COORDINATION' && p.groupId === groupId,
          )
        )
      : allCbsds;

    // Sort by serial number — stable and hardware-bound
    const sorted  = [...groupCbsds].sort((a, b) =>
      (a.cbsdSerialNumber ?? a.cbsdId).localeCompare(b.cbsdSerialNumber ?? b.cbsdId)
    );
    const idx     = sorted.findIndex(c => c.cbsdId === cbsdId);
    const slotIdx = idx >= 0 ? idx % slots.length : 0;
    this.logger.trace({ cbsdId, serial: sorted[idx]?.cbsdSerialNumber, groupId, slotIdx, total: sorted.length, slots: slots.length }, 'Deterministic slot assigned');
    return slots[slotIdx];
  }

  // ─── Find best matching frequency band for a requested range ─────────────────
  // Returns the most specific band whose range contains the request,
  // or falls back to the legacy allowedBandLow/High if no bands configured.
  private findMatchingBand(cfg: SasConfig, reqLow: number, reqHigh: number): SasFrequencyBand | null {
    const bands = cfg.frequencyBands ?? [];
    if (bands.length === 0) {
      // Legacy fallback
      return {
        id:              'legacy',
        label:           'Default',
        lowFrequency:    cfg.allowedBandLow,
        highFrequency:   cfg.allowedBandHigh,
        maxBandwidthMhz: cfg.defaultGrantBandwidthMhz ?? 20,
      };
    }

    // Find bands that contain the requested range (at least partially)
    const overlapping = bands.filter(b =>
      reqLow < b.highFrequency && reqHigh > b.lowFrequency,
    );
    if (overlapping.length === 0) return null;

    // Pick the band with the smallest range (most specific match)
    return overlapping.sort(
      (a, b) => (a.highFrequency - a.lowFrequency) - (b.highFrequency - b.lowFrequency),
    )[0];
  }

  // ─── 3-level band resolution ──────────────────────────────────────────────────────────────
  // Priority: CBSD override > group policy > findMatchingBand (global)
  private async resolveBand(
    cfg:     SasConfig,
    cbsd:    SasCbsd,
    reqLow:  number,
    reqHigh: number,
  ): Promise<SasFrequencyBand | null> {
    const bands = cfg.frequencyBands ?? [];
    // 1 — Per-CBSD override (keyed by fccId:serial, survives Clear DB)
    const cbsdKey    = `${cbsd.fccId}:${cbsd.cbsdSerialNumber}`;
    const cbsdPolicy = await this.cbsdPolicies.findOne({ _id: cbsdKey });
    if (cbsdPolicy) {
      const band = bands.find(b => b.id === cbsdPolicy.bandId);
      if (band) { this.logger.trace({ cbsdId: cbsd.cbsdId, bandId: band.id, label: band.label }, 'Band resolved via CBSD override'); return band; }
    }
    // 2 — Interference group policy
    const groupId = cbsd.groupingParam?.find(p => p.groupType === 'INTERFERENCE_COORDINATION')?.groupId;
    if (groupId) {
      const groupPolicy = await this.groupPolicies.findOne({ _id: groupId });
      if (groupPolicy) {
        const band = bands.find(b => b.id === groupPolicy.bandId);
        if (band) { this.logger.trace({ cbsdId: cbsd.cbsdId, groupId, bandId: band.id, label: band.label }, 'Band resolved via group policy'); return band; }
      }
    }
    // 3 — Global: best-matching band for the requested range
    return this.findMatchingBand(cfg, reqLow, reqHigh);
  }

  // ─── Policy CRUD ──────────────────────────────────────────────────────────────────────
  async listGroupPolicies(): Promise<GroupBandPolicy[]> { return this.groupPolicies.find({}).toArray(); }
  async setGroupPolicy(groupId: string, bandId: string, notes?: string): Promise<GroupBandPolicy> {
    const p: GroupBandPolicy = { _id: groupId, bandId, notes, updatedAt: new Date() };
    await this.groupPolicies.replaceOne({ _id: groupId }, p, { upsert: true });
    this.logger.info({ groupId, bandId }, 'Group band policy set'); return p;
  }
  async deleteGroupPolicy(groupId: string): Promise<boolean> {
    return (await this.groupPolicies.deleteOne({ _id: groupId })).deletedCount > 0;
  }
  async listCbsdPolicies(): Promise<CbsdBandPolicy[]> { return this.cbsdPolicies.find({}).toArray(); }
  async setCbsdPolicy(fccId: string, serial: string, bandId: string, notes?: string): Promise<CbsdBandPolicy> {
    const key = `${fccId}:${serial}`;
    const p: CbsdBandPolicy = { _id: key, fccId, serial, bandId, notes, updatedAt: new Date() };
    await this.cbsdPolicies.replaceOne({ _id: key }, p, { upsert: true });
    this.logger.info({ key, bandId }, 'CBSD band policy set'); return p;
  }
  async deleteCbsdPolicy(fccId: string, serial: string): Promise<boolean> {
    return (await this.cbsdPolicies.deleteOne({ _id: `${fccId}:${serial}` })).deletedCount > 0;
  }

  // ─── GPS lock delay ───────────────────────────────────────────────────────
  // Baicells BaiBLQ firmware re-grants after GPS locks (~30-45s after boot).
  // Track by serial number so re-registrations don't reset the clock.
  private firstSeenTime = new Map<string, number>(); // fccId:serial -> timestamp ms
  private static GPS_LOCK_DELAY_MS = 75_000; // 75 seconds — covers GPS lock window

  private gpsDelayKey(fccId: string, serial: string): string {
    return `${fccId}:${serial}`;
  }

  private recordFirstSeen(fccId: string, serial: string): void {
    const key = this.gpsDelayKey(fccId, serial);
    if (!this.firstSeenTime.has(key)) {
      this.firstSeenTime.set(key, Date.now());
      this.logger.info({ fccId, serial }, 'GPS delay clock started');
    }
  }

  private msSinceFirstSeen(fccId: string, serial: string): number {
    const key = this.gpsDelayKey(fccId, serial);
    const t = this.firstSeenTime.get(key);
    if (!t) return SasService.GPS_LOCK_DELAY_MS; // unknown — allow through
    return Date.now() - t;
  }

  // ─── Config ───────────────────────────────────────────────────────────────
  async getConfig(): Promise<SasConfig> {
    const cfg = await this.configs.findOne({ _id: 'sas_config' });
    if (!cfg) throw new Error('SAS config not found');
    return cfg;
  }

  async updateConfig(patch: Partial<Omit<SasConfig, '_id' | 'updatedAt'>>): Promise<SasConfig> {
    await this.configs.updateOne(
      { _id: 'sas_config' },
      { $set: { ...patch, updatedAt: new Date() } },
      { upsert: true },
    );
    return this.getConfig();
  }

  // ─── Registration (section 8.3) ───────────────────────────────────────────
  async registration(requests: RegistrationRequest[]): Promise<RegistrationResponse[]> {
    const responses: RegistrationResponse[] = [];

    for (const req of requests) {
      if (!req.userId || !req.fccId || !req.cbsdSerialNumber) {
        const missing = ['userId', 'fccId', 'cbsdSerialNumber'].filter(k => !(req as any)[k]);
        responses.push({ response: makeResponse(RC.MISSING_PARAM, missing) });
        continue;
      }

      const existing = await this.cbsds.findOne({
        cbsdSerialNumber: req.cbsdSerialNumber,
        fccId:            req.fccId,
      });

      if (existing) {
        await this.grants.deleteMany({ cbsdId: existing.cbsdId });
        await this.cbsds.updateOne(
          { cbsdId: existing.cbsdId },
          { $set: {
            userId:            req.userId,
            cbsdCategory:      req.cbsdCategory      ?? existing.cbsdCategory,
            airInterface:      req.airInterface       ?? existing.airInterface,
            installationParam: req.installationParam  ?? existing.installationParam,
            measCapability:    req.measCapability     ?? existing.measCapability,
            state:             'REGISTERED' as const,
            lastSeen:          new Date(),
          }},
        );
        responses.push({ cbsdId: existing.cbsdId, response: makeResponse(RC.SUCCESS) });
        this.logger.info({ cbsdId: existing.cbsdId }, 'CBSD re-registered');
        this.recordFirstSeen(req.fccId, req.cbsdSerialNumber);
      } else {
        const cbsdId = uuidv4();
        await this.cbsds.insertOne({
          cbsdId,
          cbsdSerialNumber:  req.cbsdSerialNumber,
          fccId:             req.fccId,
          userId:            req.userId,
          cbsdCategory:      req.cbsdCategory ?? 'A',
          state:             'REGISTERED',
          airInterface:      req.airInterface,
          installationParam: req.installationParam,
          measCapability:    req.measCapability,
          groupingParam:     req.groupingParam,
          registeredAt:      new Date(),
          lastSeen:          new Date(),
        });
        responses.push({ cbsdId, response: makeResponse(RC.SUCCESS) });
        this.logger.info({ cbsdId, fccId: req.fccId, serial: req.cbsdSerialNumber }, 'CBSD registered');
        this.recordFirstSeen(req.fccId, req.cbsdSerialNumber);
      }
    }

    return responses;
  }

  // ─── Spectrum Inquiry (section 8.4) ──────────────────────────────────────
  async spectrumInquiry(requests: SpectrumInquiryRequest[]): Promise<SpectrumInquiryResponse[]> {
    const cfg       = await this.getConfig();
    const responses: SpectrumInquiryResponse[] = [];

    for (const req of requests) {
      if (!req.cbsdId) {
        responses.push({ response: makeResponse(RC.MISSING_PARAM, ['cbsdId']) });
        continue;
      }

      const cbsd = await this.cbsds.findOne({ cbsdId: req.cbsdId, state: 'REGISTERED' });
      if (!cbsd) {
        // CBSD unknown — tell radio to re-register from scratch (RC 105 DEREGISTER)
        responses.push({ response: makeResponse(RC.DEREGISTER) });
        continue;
      }

      let unsupported = false;
      for (const fr of req.inquiredSpectrum ?? []) {
        // Check using 3-level resolution: CBSD override > group policy > global bands
        const resolvedBand = await this.resolveBand(cfg, cbsd, fr.lowFrequency, fr.highFrequency);
        if (!resolvedBand) {
          responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.UNSUPPORTED_SPECTRUM) });
          unsupported = true;
          break;
        }
      }
      if (unsupported) continue;

      // Return only the CBSD's resolved band(s) as available channels
      // Use the first inquired spectrum range for resolution (representative)
      const firstFr = req.inquiredSpectrum?.[0];
      const resolvedBand = firstFr
        ? await this.resolveBand(cfg, cbsd, firstFr.lowFrequency, firstFr.highFrequency)
        : null;
      const bands = cfg.frequencyBands ?? [];
      const availableChannel: AvailableChannel[] = resolvedBand
        ? [{ frequencyRange: { lowFrequency: resolvedBand.lowFrequency, highFrequency: resolvedBand.highFrequency }, channelType: 'GAA' as const, ruleApplied: 'FCC_PART_96', maxEirp: resolvedBand.maxEirp ?? cfg.maxEirpGAA }]
        : bands.length > 0
          ? bands.map(b => ({ frequencyRange: { lowFrequency: b.lowFrequency, highFrequency: b.highFrequency }, channelType: 'GAA' as const, ruleApplied: 'FCC_PART_96', maxEirp: b.maxEirp ?? cfg.maxEirpGAA }))
          : [{ frequencyRange: { lowFrequency: cfg.allowedBandLow, highFrequency: cfg.allowedBandHigh }, channelType: 'GAA' as const, ruleApplied: 'FCC_PART_96', maxEirp: cfg.maxEirpGAA }];

      await this.cbsds.updateOne({ cbsdId: req.cbsdId }, { $set: { lastSeen: new Date() } });
      responses.push({ cbsdId: req.cbsdId, availableChannel, response: makeResponse(RC.SUCCESS) });
    }

    return responses;
  }

  // ─── Grant (section 8.5) ─────────────────────────────────────────────────
  async grant(requests: GrantRequest[]): Promise<GrantResponse[]> {
    const cfg       = await this.getConfig();
    const responses: GrantResponse[] = [];

    for (const req of requests) {
      if (!req.cbsdId) {
        responses.push({ response: makeResponse(RC.MISSING_PARAM, ['cbsdId']) });
        continue;
      }
      if (!req.operationParam) {
        responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.MISSING_PARAM, ['operationParam']) });
        continue;
      }

      const cbsd = await this.cbsds.findOne({ cbsdId: req.cbsdId, state: 'REGISTERED' });
      if (!cbsd) {
        // CBSD unknown — tell radio to re-register
        responses.push({ response: makeResponse(RC.DEREGISTER) });
        continue;
      }

      // GPS lock delay — hold off granting until GPS has had time to lock.
      // Keyed by fccId:serial so re-registrations don't reset the clock.
      const msSinceReg = this.msSinceFirstSeen(cbsd.fccId, cbsd.cbsdSerialNumber);
      if (msSinceReg < SasService.GPS_LOCK_DELAY_MS) {
        const waitSec = Math.ceil((SasService.GPS_LOCK_DELAY_MS - msSinceReg) / 1000);
        this.logger.info({ cbsdId: req.cbsdId, msSinceReg, waitSec }, 'GPS lock delay — holding grant');
        responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.UNSUPPORTED_SPECTRUM) });
        continue;
      }

      const { lowFrequency, highFrequency } = req.operationParam.operationFrequencyRange;

      // Find the best matching configured band using 3-level policy resolution
      const matchedBand = await this.resolveBand(cfg, cbsd, lowFrequency, highFrequency);
      if (!matchedBand) {
        responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.UNSUPPORTED_SPECTRUM) });
        continue;
      }

      // Validate the request overlaps our band (not entirely outside)
      if (lowFrequency >= matchedBand.highFrequency || highFrequency <= matchedBand.lowFrequency) {
        responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.UNSUPPORTED_SPECTRUM) });
        continue;
      }

      // Check for existing active grant on overlapping frequency
      const existingGrant = await this.grants.findOne({
        cbsdId: req.cbsdId,
        state:  { $in: ['GRANTED', 'AUTHORIZED'] },
        'operationParam.operationFrequencyRange.lowFrequency':  { $lt: highFrequency },
        'operationParam.operationFrequencyRange.highFrequency': { $gt: lowFrequency },
      });
      if (existingGrant) {
        // Grant exists — return it regardless of state so radio can heartbeat it
        this.logger.trace({ cbsdId: req.cbsdId, grantId: existingGrant.grantId, state: existingGrant.state }, 'Duplicate grant request — returning existing grant');
        responses.push({
          cbsdId:            req.cbsdId,
          grantId:           existingGrant.grantId,
          grantExpireTime:   sasFmt(existingGrant.grantExpireTime),
          heartbeatInterval: cfg.heartbeatInterval,
          channelType:       'GAA',
          operationParam:    existingGrant.operationParam,
          response:          makeResponse(RC.SUCCESS),
        });
        continue;
      }

      // Use matched band's EIRP limit, falling back to global
      const requestedEirp = req.operationParam.maxEirp;
      const bandMaxEirp   = matchedBand.maxEirp ?? cfg.maxEirpGAA;
      const maxEirp       = (requestedEirp <= 0) ? bandMaxEirp : Math.min(requestedEirp, bandMaxEirp);

      // Assign a unique non-overlapping channel slot deterministically.
      // Slot is based on cbsdId sort position within the interference group —
      // guaranteed unique and race-condition-proof.
      const slotWidthHz = (matchedBand.maxBandwidthMhz ?? cfg.defaultGrantBandwidthMhz ?? 20) * 1_000_000;
      const groupId     = cbsd.groupingParam?.find(p => p.groupType === 'INTERFERENCE_COORDINATION')?.groupId;
      const slot        = await this.assignChannelSlot(req.cbsdId, groupId, matchedBand, slotWidthHz);

      const grantLow    = slot.low;
      const clampedHigh = slot.high;

      const grantId         = uuidv4();
      const now             = new Date();
      const grantExpireTime = new Date(now.getTime() + cfg.grantExpireHours * 3_600_000);

      await this.grants.insertOne({
        grantId,
        cbsdId:            req.cbsdId,
        state:             'AUTHORIZED',
        channelType:       'GAA',
        operationParam:    { maxEirp, operationFrequencyRange: { lowFrequency: grantLow, highFrequency: clampedHigh } },
        grantExpireTime,
        heartbeatInterval: cfg.heartbeatInterval,
        transmitExpireTime: new Date(now.getTime() + cfg.heartbeatInterval * 3 * 1_000),
        lastHeartbeat:     now,
        createdAt:         now,
      });

      await this.cbsds.updateOne({ cbsdId: req.cbsdId }, { $set: { lastSeen: now } });

      responses.push({
        cbsdId:            req.cbsdId,
        grantId,
        grantExpireTime:   sasFmt(grantExpireTime),
        heartbeatInterval: cfg.heartbeatInterval,
        channelType:       'GAA',
        operationParam:    { maxEirp, operationFrequencyRange: { lowFrequency: grantLow, highFrequency: clampedHigh } },
        response:          makeResponse(RC.SUCCESS),
      });

      const slotMhz = `${(grantLow/1e6).toFixed(1)}–${(clampedHigh/1e6).toFixed(1)} MHz`;
      const earfcn  = Math.round(55240 + (((grantLow + clampedHigh) / 2) / 1e6 - 3550) * 10);
      this.logger.info({ cbsdId: req.cbsdId, grantId, lowFrequency: grantLow, highFrequency: clampedHigh, maxEirp, slotMhz, earfcn, groupId }, 'Grant issued');
    }

    return responses;
  }

  // ─── Heartbeat (section 8.6) ──────────────────────────────────────────────
  async heartbeat(requests: HeartbeatRequest[]): Promise<HeartbeatResponse[]> {
    const cfg       = await this.getConfig();
    const responses: HeartbeatResponse[] = [];

    for (const req of requests) {
      if (!req.cbsdId) {
        responses.push({ transmitExpireTime: sasFmt(new Date()), response: makeResponse(RC.MISSING_PARAM, ['cbsdId']) });
        continue;
      }
      if (!req.grantId) {
        responses.push({ cbsdId: req.cbsdId, transmitExpireTime: sasFmt(new Date()), response: makeResponse(RC.MISSING_PARAM, ['grantId']) });
        continue;
      }

      const grant = await this.grants.findOne({ grantId: req.grantId, cbsdId: req.cbsdId });
      if (!grant) {
        // Grant unknown — return TERMINATED_GRANT so radio relinquishes and re-requests
        responses.push({
          cbsdId:             req.cbsdId,
          grantId:            req.grantId,
          transmitExpireTime: sasFmt(new Date()),
          response:           makeResponse(RC.TERMINATED_GRANT),
        });
        continue;
      }

      if (grant.state === 'TERMINATED' || new Date() > grant.grantExpireTime) {
        responses.push({
          cbsdId:             req.cbsdId,
          grantId:            req.grantId,
          transmitExpireTime: sasFmt(new Date()),
          response:           makeResponse(RC.TERMINATED_GRANT),
        });
        continue;
      }

      const now                = new Date();
      // transmitExpireTime must be well beyond the next heartbeat due time.
      // The radio must heartbeat BEFORE this expires or it stops transmitting.
      // We give 3× the heartbeat interval — this covers GPS init sequences
      // (which can take several minutes) without being dangerously permissive.
      const transmitExpireTime = new Date(now.getTime() + cfg.heartbeatInterval * 3 * 1_000);
      let newGrantExpireTime   = grant.grantExpireTime;
      if (req.grantRenew) {
        newGrantExpireTime = new Date(now.getTime() + cfg.grantExpireHours * 3_600_000);
      }

      await this.grants.updateOne(
        { grantId: req.grantId },
        { $set: {
          state:             'AUTHORIZED',
          lastHeartbeat:     now,
          transmitExpireTime,
          grantExpireTime:   newGrantExpireTime,
        }},
      );
      await this.cbsds.updateOne({ cbsdId: req.cbsdId }, { $set: { lastSeen: now } });

      const resp: HeartbeatResponse = {
        cbsdId:             req.cbsdId,
        grantId:            req.grantId,
        transmitExpireTime: sasFmt(transmitExpireTime),
        heartbeatInterval:  cfg.heartbeatInterval,
        response:           makeResponse(RC.SUCCESS),
      };
      if (req.grantRenew) resp.grantExpireTime = sasFmt(newGrantExpireTime);

      responses.push(resp);
    }

    return responses;
  }

  // ─── Relinquishment (section 8.7) ─────────────────────────────────────────
  async relinquishment(requests: RelinquishmentRequest[]): Promise<RelinquishmentResponse[]> {
    const responses: RelinquishmentResponse[] = [];

    for (const req of requests) {
      if (!req.cbsdId) {
        responses.push({ response: makeResponse(RC.MISSING_PARAM, ['cbsdId']) });
        continue;
      }
      if (!req.grantId) {
        responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.MISSING_PARAM, ['grantId']) });
        continue;
      }

      const grant = await this.grants.findOne({ grantId: req.grantId, cbsdId: req.cbsdId });
      if (!grant) {
        // Grant already gone — still return success so radio moves on
        responses.push({ cbsdId: req.cbsdId, grantId: req.grantId, response: makeResponse(RC.SUCCESS) });
        continue;
      }

      await this.grants.deleteOne({ grantId: req.grantId });
      await this.cbsds.updateOne({ cbsdId: req.cbsdId }, { $set: { lastSeen: new Date() } });

      responses.push({ cbsdId: req.cbsdId, grantId: req.grantId, response: makeResponse(RC.SUCCESS) });
      this.logger.info({ cbsdId: req.cbsdId, grantId: req.grantId }, 'Grant relinquished');
    }

    return responses;
  }

  // ─── Deregistration (section 8.8) ─────────────────────────────────────────
  async deregistration(requests: DeregistrationRequest[]): Promise<DeregistrationResponse[]> {
    const responses: DeregistrationResponse[] = [];

    for (const req of requests) {
      if (!req.cbsdId) {
        responses.push({ response: makeResponse(RC.MISSING_PARAM, ['cbsdId']) });
        continue;
      }

      const cbsd = await this.cbsds.findOne({ cbsdId: req.cbsdId });
      if (!cbsd) {
        // Already gone — return SUCCESS so radio moves on cleanly
        responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.SUCCESS) });
        continue;
      }

      await this.grants.deleteMany({ cbsdId: req.cbsdId });
      await this.cbsds.updateOne({ cbsdId: req.cbsdId }, { $set: { state: 'UNREGISTERED' } });

      responses.push({ cbsdId: req.cbsdId, response: makeResponse(RC.SUCCESS) });
      this.logger.info({ cbsdId: req.cbsdId }, 'CBSD deregistered');
    }

    return responses;
  }

  // ─── Admin queries ────────────────────────────────────────────────────────
  async listCbsds(): Promise<SasCbsd[]> {
    return this.cbsds.find({ state: 'REGISTERED' }).sort({ lastSeen: -1 }).toArray();
  }

  async listGrants(cbsdId?: string): Promise<SasGrant[]> {
    const filter = cbsdId ? { cbsdId } : {};
    return this.grants.find(filter).sort({ createdAt: -1 }).toArray();
  }

  async getStats(): Promise<{ registeredCbsds: number; activeGrants: number; authorizedGrants: number }> {
    const [registeredCbsds, activeGrants, authorizedGrants] = await Promise.all([
      this.cbsds.countDocuments({ state: 'REGISTERED' }),
      this.grants.countDocuments({ state: { $in: ['GRANTED', 'AUTHORIZED'] } }),
      this.grants.countDocuments({ state: 'AUTHORIZED' }),
    ]);
    return { registeredCbsds, activeGrants, authorizedGrants };
  }

  // Returns slot layout for ALL configured bands — used by the spectrum chart
  async getSlotLayout(): Promise<{
    bands: Array<{
      bandLow: number; bandHigh: number; label: string;
      slotWidthHz: number;
      slots: Array<{ low: number; high: number; earfcn: number; cbsdId?: string; serial?: string; fccId?: string; state?: string }>;
    }>;
    // Legacy flat fields for backward compat
    bandLow: number; bandHigh: number; slotWidthHz: number;
    slots: Array<{ low: number; high: number; earfcn: number; cbsdId?: string; serial?: string; state?: string }>;
  }> {
    const cfg          = await this.getConfig();
    const activeGrants = await this.grants.find({ state: { $in: ['GRANTED', 'AUTHORIZED'] } }).toArray();
    const cbsdMap      = new Map<string, SasCbsd>();
    const cbsds        = await this.cbsds.find({}).toArray();
    for (const c of cbsds) cbsdMap.set(c.cbsdId, c);

    const configBands = cfg.frequencyBands?.length
      ? cfg.frequencyBands
      : [{ id: 'legacy', label: 'Default', lowFrequency: cfg.allowedBandLow, highFrequency: cfg.allowedBandHigh, maxBandwidthMhz: cfg.defaultGrantBandwidthMhz ?? 20 } as SasFrequencyBand];

    const bandResults = configBands.map(band => {
      const slotW = (band.maxBandwidthMhz ?? 20) * 1_000_000;
      const slots = this.computeSlots(band, slotW);

      return {
        bandLow:     band.lowFrequency,
        bandHigh:    band.highFrequency,
        label:       band.label,
        slotWidthHz: slotW,
        slots: slots.map(s => {
          const centerHz  = (s.low + s.high) / 2;
          const centerMhz = centerHz / 1e6;
          const earfcn    = Math.round(55240 + (centerMhz - 3550) * 10);
          const grant     = activeGrants.find(g =>
            g.operationParam.operationFrequencyRange.lowFrequency  >= s.low - 1 &&
            g.operationParam.operationFrequencyRange.highFrequency <= s.high + 1,
          );
          const cbsd = grant ? cbsdMap.get(grant.cbsdId) : undefined;
          return {
            low: s.low, high: s.high, earfcn,
            ...(grant ? { cbsdId: grant.cbsdId, state: grant.state } : {}),
            ...(cbsd  ? { serial: cbsd.cbsdSerialNumber, fccId: cbsd.fccId } : {}),
          };
        }),
      };
    });

    // Flat legacy fields from first band
    const first = bandResults[0];
    return {
      bands:       bandResults,
      bandLow:     first.bandLow,
      bandHigh:    first.bandHigh,
      slotWidthHz: first.slotWidthHz,
      slots:       first.slots,
    };
  }

  // ─── 30-second summary logger ───────────────────────────────────────────────────────────────
  // Replaces the per-request noise in docker logs with a clean status line.
  private summaryInterval: ReturnType<typeof setInterval> | null = null;

  startSummaryLogger(intervalMs = 30_000): void {
    if (this.summaryInterval) return;
    this.summaryInterval = setInterval(() => this.logSummary(), intervalMs);
  }

  stopSummaryLogger(): void {
    if (this.summaryInterval) { clearInterval(this.summaryInterval); this.summaryInterval = null; }
  }

  private async logSummary(): Promise<void> {
    try {
      const activeGrants = await this.grants
        .find({ state: { $in: ['GRANTED', 'AUTHORIZED'] } })
        .toArray();

      if (activeGrants.length === 0) {
        this.logger.info('SAS ─ no active grants');
        return;
      }

      const cbsdMap = new Map<string, SasCbsd>();
      const cbsds   = await this.cbsds.find({}).toArray();
      for (const c of cbsds) cbsdMap.set(c.cbsdId, c);

      const lines = activeGrants.map(g => {
        const cbsd   = cbsdMap.get(g.cbsdId);
        const serial = cbsd?.cbsdSerialNumber ?? g.cbsdId.slice(0, 8);
        const low    = (g.operationParam.operationFrequencyRange.lowFrequency  / 1e6).toFixed(1);
        const high   = (g.operationParam.operationFrequencyRange.highFrequency / 1e6).toFixed(1);
        const earfcn = Math.round(
          55240 + (((g.operationParam.operationFrequencyRange.lowFrequency +
                     g.operationParam.operationFrequencyRange.highFrequency) / 2) / 1e6 - 3550) * 10,
        );
        const state  = g.state === 'AUTHORIZED' ? '●' : '○';
        return `${state} ${serial.slice(-10).padEnd(10)} ${low}-${high}MHz EARFCN:${earfcn}`;
      });

      this.logger.info(`SAS ─ ${activeGrants.length} active grant${activeGrants.length > 1 ? 's' : ''}:\n  ${lines.join('\n  ')}`);
    } catch { /* silent */ }
  }

  // ─── Reset all SAS state ───────────────────────────────────────────────
  // Deletes all grants and CBSDs, clears in-memory GPS delay clocks.
  async resetAll(): Promise<{ deletedGrants: number; deletedCbsds: number }> {
    const [grants, cbsds] = await Promise.all([
      this.grants.deleteMany({}),
      this.cbsds.deleteMany({}),
    ]);
    this.firstSeenTime.clear();
    this.logger.info({ deletedGrants: grants.deletedCount, deletedCbsds: cbsds.deletedCount }, 'SAS DB cleared');
    return { deletedGrants: grants.deletedCount ?? 0, deletedCbsds: cbsds.deletedCount ?? 0 };
  }

  // ─── Pause / Resume SAS responses ────────────────────────────────────────
  // When paused, all SAS protocol endpoints return DEREGISTER so radios
  // stop transmitting and wait. No data is deleted.
  private paused = false;

  pauseSas():  void { this.paused = true;  this.logger.warn('SAS PAUSED — all requests will return DEREGISTER'); }
  resumeSas(): void { this.paused = false; this.logger.info('SAS RESUMED — normal operation'); }
  isPaused():  boolean { return this.paused; }

  async deleteGrant(grantId: string): Promise<boolean> {
    const result = await this.grants.deleteOne({ grantId });
    if (result.deletedCount > 0) this.logger.info({ grantId }, 'Grant deleted by admin');
    return result.deletedCount > 0;
  }

  async deleteCbsd(cbsdId: string): Promise<boolean> {
    await this.grants.deleteMany({ cbsdId });
    const result = await this.cbsds.deleteOne({ cbsdId });
    if (result.deletedCount > 0) this.logger.info({ cbsdId }, 'CBSD deleted by admin');
    return result.deletedCount > 0;
  }

  isReady(): boolean { return this.ready; }

  // ─── Background grant keeper ──────────────────────────────────────────────
  // Baicells BaiBLQ firmware stops heartbeating after GPS lock but keeps the
  // grant in GRANTED state forever. We heartbeat on behalf of all active grants
  // server-side so they never expire, regardless of radio behavior.
  private keeperInterval: ReturnType<typeof setInterval> | null = null;

  startGrantKeeper(intervalMs = 200_000): void {
    if (this.keeperInterval) return;
    this.logger.info({ intervalMs }, 'SAS grant keeper started');
    this.keeperInterval = setInterval(() => this.runGrantKeeper(), intervalMs);
  }

  stopGrantKeeper(): void {
    if (this.keeperInterval) {
      clearInterval(this.keeperInterval);
      this.keeperInterval = null;
    }
  }

  private async runGrantKeeper(): Promise<void> {
    try {
      const cfg    = await this.getConfig();
      const now    = new Date();
      const cutoff = new Date(now.getTime() + cfg.heartbeatInterval * 2 * 1_000);
      // Only touch grants the radio hasn't heartbeated recently (>3 min ago)
      // This prevents the keeper from interfering with grants the radio is managing
      const recentCutoff = new Date(now.getTime() - 3 * 60 * 1_000);

      const grants = await this.grants.find({
        state: { $in: ['GRANTED', 'AUTHORIZED'] },
        grantExpireTime: { $gt: now },
        $and: [
          {
            $or: [
              { transmitExpireTime: { $lt: cutoff } },
              { transmitExpireTime: { $exists: false } },
              { state: 'GRANTED' },
            ],
          },
          {
            // Only touch if radio hasn't heartbeated in the last 3 minutes
            $or: [
              { lastHeartbeat: { $lt: recentCutoff } },
              { lastHeartbeat: { $exists: false } },
            ],
          },
        ],
      }).toArray();

      if (grants.length === 0) return;

      this.logger.trace({ count: grants.length }, 'Grant keeper: renewing stale grants');

      const transmitExpireTime = new Date(now.getTime() + cfg.heartbeatInterval * 3 * 1_000);

      for (const grant of grants) {
        await this.grants.updateOne(
          { grantId: grant.grantId },
          { $set: {
            state:             'AUTHORIZED',
            lastHeartbeat:     now,
            transmitExpireTime,
          }},
        );
        this.logger.trace(
          { grantId: grant.grantId, cbsdId: grant.cbsdId, wasState: grant.state },
          'Grant keeper: renewed grant to AUTHORIZED',
        );
      }
    } catch (err) {
      this.logger.error({ err: String(err) }, 'Grant keeper error');
    }
  }
}
