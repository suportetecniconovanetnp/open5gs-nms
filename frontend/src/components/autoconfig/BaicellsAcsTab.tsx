import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Radio, RefreshCw, Send, ChevronDown, ChevronUp,
  AlertCircle, Clock, ExternalLink, RotateCw, Wifi, WifiOff,
} from 'lucide-react';
import { genieacsApi, BaicellsRadio, ProvisionInput, NbiTask } from '../../api';
import { ProvisionConfirmModal } from './ProvisionConfirmModal';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

const POLL_INTERVAL_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatLastInform(ts: string | null): string {
  if (!ts) return 'Never';
  const d    = new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function RfDot({ status }: { status: BaicellsRadio['rfStatus'] }) {
  return (
    <span
      title={status === 'on' ? 'RF On' : status === 'off' ? 'RF Off (radio up)' : 'Offline'}
      className={clsx(
        'inline-block w-2.5 h-2.5 rounded-full flex-shrink-0',
        status === 'on'      && 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]',
        status === 'off'     && 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]',
        status === 'offline' && 'bg-red-500',
      )}
    />
  );
}

// ─── Editable form state ──────────────────────────────────────────────────────
interface RadioForm {
  mcc: string; mnc: string; tac: string; mmeIp: string;
  bandwidthMhz: string; earfcn: string; cellId: string; pci: string; band: string;
}

function radioToForm(r: BaicellsRadio): RadioForm {
  return { mcc: r.mcc, mnc: r.mnc, tac: r.tac, mmeIp: r.mmeIp,
           bandwidthMhz: r.bandwidthMhz, earfcn: r.earfcn, cellId: r.cellId, pci: r.pci, band: r.band };
}

function formToInput(f: RadioForm): ProvisionInput {
  return {
    mcc: f.mcc.trim(), mnc: f.mnc.trim(), mmeIp: f.mmeIp.trim(),
    tac: parseInt(f.tac), bandwidthMhz: parseInt(f.bandwidthMhz),
    earfcn: parseInt(f.earfcn), cellId: parseInt(f.cellId),
    pci: parseInt(f.pci), band: parseInt(f.band),
  };
}

// ─── Single radio row ─────────────────────────────────────────────────────────
const RadioRow: React.FC<{ radio: BaicellsRadio; onRefresh: () => void }> = ({ radio, onRefresh }) => {
  const [expanded, setExpanded]   = useState(false);
  const [form, setForm]           = useState<RadioForm>(radioToForm(radio));
  const [refreshing, setRefreshing] = useState(false);
  const [rebooting, setRebooting]   = useState(false);
  const [rfBusy, setRfBusy]         = useState(false);
  const [previewTasks, setPreviewTasks] = useState<NbiTask[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => { setForm(radioToForm(radio)); }, [radio]);

  const set = (key: keyof RadioForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await genieacsApi.forceRefresh(radio.id);
      toast.success(`${radio.serial}: connection request sent, refreshing in 10s…`);
      setTimeout(onRefresh, 10000);
    } catch (err: any) {
      toast.error(`Refresh failed: ${err?.response?.data?.error ?? err?.message ?? 'Unknown error'}`);
    } finally { setRefreshing(false); }
  };

  const handleReboot = async () => {
    if (!confirm(`Reboot ${radio.serial}?\n\nThe radio will be unreachable for ~2 minutes.`)) return;
    setRebooting(true);
    try {
      await genieacsApi.reboot(radio.id);
      toast.success(`${radio.serial}: reboot queued.`);
    } catch (err: any) {
      toast.error(`Reboot failed: ${err?.response?.data?.error ?? err?.message}`);
    } finally { setRebooting(false); }
  };

  const handleRf = async (enable: boolean) => {
    if (!enable && !confirm(`Disable RF on ${radio.serial}?`)) return;
    setRfBusy(true);
    try {
      await genieacsApi.setRf(radio.id, enable);
      toast.success(`${radio.serial}: RF ${enable ? 'enabled' : 'disabled'}.`);
      setTimeout(onRefresh, 5000);
    } catch (err: any) {
      toast.error(`RF set failed: ${err?.response?.data?.error ?? err?.message}`);
    } finally { setRfBusy(false); }
  };

  const handlePushConfig = async () => {
    const input = formToInput(form);
    if (Object.values(input).some(v => v === '' || (typeof v === 'number' && isNaN(v)))) {
      toast.error('All fields are required');
      return;
    }
    setPreviewLoading(true);
    try {
      const preview = await genieacsApi.preview(radio.id, input);
      setPreviewTasks(preview.tasks);
    } catch (err: any) {
      toast.error(`Preview failed: ${err?.response?.data?.error ?? err?.message}`);
    } finally { setPreviewLoading(false); }
  };

  return (
    <>
      {previewTasks && (
        <ProvisionConfirmModal
          deviceId={radio.id}
          serial={radio.serial}
          tasks={previewTasks}
          onClose={() => setPreviewTasks(null)}
          onSuccess={() => { setPreviewTasks(null); setExpanded(false); onRefresh(); }}
        />
      )}

      <div className="border border-nms-border rounded-lg overflow-hidden">
        {/* ── Summary row ── */}
        <button
          className="w-full flex items-center gap-3 px-4 py-3 bg-nms-surface hover:bg-nms-surface-2 transition-colors text-left"
          onClick={() => setExpanded(e => !e)}
        >
          <RfDot status={radio.rfStatus} />
          <Radio className="w-4 h-4 text-nms-accent flex-shrink-0" />
          <span className="font-mono text-sm text-nms-text flex-1 truncate">{radio.serial}</span>
          {radio.ip && (
            <span className="text-xs text-nms-text-dim font-mono">{radio.ip}</span>
          )}
          <span className={clsx(
            'text-xs px-2 py-0.5 rounded-full flex items-center gap-1',
            radio.lastInform ? 'bg-green-500/15 text-green-400' : 'bg-nms-surface-2 text-nms-text-dim',
          )}>
            <Clock className="w-3 h-3" />
            {formatLastInform(radio.lastInform)}
          </span>
          <span className="text-xs text-nms-text-dim font-mono">EARFCN {radio.earfcn || '—'}</span>
          <span className="text-xs text-nms-text-dim font-mono">PCI {radio.pci || '—'}</span>
          {/* Per-row action buttons — stop propagation so they don't expand the row */}
          <button
            onClick={e => { e.stopPropagation(); handleRefresh(); }}
            disabled={refreshing}
            className="p-1 rounded hover:bg-nms-surface text-nms-text-dim hover:text-nms-accent transition-colors"
            title="Force inform — refresh values from device"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          </button>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-nms-text-dim flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-nms-text-dim flex-shrink-0" />
          }
        </button>

        {/* ── Edit form ── */}
        {expanded && (
          <div className="px-4 pb-4 pt-3 bg-nms-surface-2 border-t border-nms-border space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div><label className="nms-label">MCC</label>
                <input className="nms-input font-mono" placeholder="999" value={form.mcc} onChange={set('mcc')} maxLength={3} /></div>
              <div><label className="nms-label">MNC</label>
                <input className="nms-input font-mono" placeholder="70" value={form.mnc} onChange={set('mnc')} maxLength={3} /></div>
              <div><label className="nms-label">TAC</label>
                <input className="nms-input font-mono" placeholder="1" type="number" min={1} value={form.tac} onChange={set('tac')} /></div>
              <div><label className="nms-label">MME IP</label>
                <input className="nms-input font-mono" placeholder="10.0.1.2" value={form.mmeIp} onChange={set('mmeIp')} /></div>
              <div><label className="nms-label">Band</label>
                <select className="nms-input font-mono" value={form.band} onChange={set('band')}>
                  <option value="">Select…</option>
                  <option value="42">Band 42 (3.5 GHz)</option>
                  <option value="43">Band 43 (3.7 GHz)</option>
                  <option value="48">Band 48 (CBRS)</option>
                </select></div>
              <div><label className="nms-label">Bandwidth</label>
                <select className="nms-input font-mono" value={form.bandwidthMhz} onChange={set('bandwidthMhz')}>
                  <option value="">Select…</option>
                  <option value="5">5 MHz</option>
                  <option value="10">10 MHz</option>
                  <option value="15">15 MHz</option>
                  <option value="20">20 MHz</option>
                </select></div>
              <div><label className="nms-label">EARFCN (DL = UL)</label>
                <input className="nms-input font-mono" placeholder="56060" type="number" min={0} value={form.earfcn} onChange={set('earfcn')} /></div>
              <div><label className="nms-label">Cell ID</label>
                <input className="nms-input font-mono" placeholder="256002" type="number" min={0} value={form.cellId} onChange={set('cellId')} /></div>
              <div><label className="nms-label">PCI</label>
                <input className="nms-input font-mono" placeholder="462" type="number" min={0} max={503} value={form.pci} onChange={set('pci')} /></div>
            </div>

            <div className="text-xs text-nms-text-dim bg-nms-surface rounded px-3 py-2 border border-nms-border">
              <span className="font-semibold text-nms-text">Auto-set on push: </span>
              S1 port 36412 · TDD SubFrame 2 · SpecialSubframe 5 · GPS sync enabled ·
              Self-config EARFCN/PCI disabled · Periodic inform 5s
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleRf(true)}
                disabled={rfBusy || radio.rfStatus === 'on'}
                className="nms-btn-secondary flex items-center gap-2 text-sm text-green-400 border-green-500/30 hover:bg-green-500/10"
              >
                <Wifi className="w-4 h-4" />
                Enable RF
              </button>

              <button
                onClick={handleReboot}
                disabled={rebooting}
                className="nms-btn-secondary flex items-center gap-2 text-sm text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
              >
                <RotateCw className={clsx('w-4 h-4', rebooting && 'animate-spin')} />
                {rebooting ? 'Rebooting…' : 'Reboot'}
              </button>

              <div className="flex-1" />

              <button
                onClick={handlePushConfig}
                disabled={previewLoading}
                className="nms-btn-primary flex items-center gap-2"
              >
                {previewLoading
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Building preview…</>
                  : <><Send className="w-4 h-4" />Push Config &amp; Reboot</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ─── Main tab ────────────────────────────────────────────────────────────────
export const BaicellsAcsTab: React.FC = () => {
  const [radios, setRadios]   = useState<BaicellsRadio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [globalBusy, setGlobalBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDevices = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const devices = await genieacsApi.getDevices();
      setRadios(devices);
    } catch (err: any) {
      if (!silent) setError(err?.response?.data?.error ?? err?.message ?? 'Failed to reach GenieACS NBI');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + 30s polling
  useEffect(() => {
    fetchDevices();
    pollRef.current = setInterval(() => fetchDevices(true), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDevices]);

  const handleRebootAll = async () => {
    if (!confirm(`Reboot ALL ${radios.length} radio(s)?\n\nAll radios will be unreachable for ~2 minutes.`)) return;
    setGlobalBusy(true);
    try {
      const r = await genieacsApi.rebootAll();
      if (r.success) toast.success(`All ${r.rebooted} radios queued for reboot.`);
      else toast.error(`Reboot all: ${r.failures.length} failure(s). Check audit log.`);
    } catch (err: any) {
      toast.error(`Reboot all failed: ${err?.response?.data?.error ?? err?.message}`);
    } finally { setGlobalBusy(false); }
  };

  const handleRfAll = async (enable: boolean) => {
    const verb = enable ? 'Enable RF on' : 'Disable RF on';
    const warn = enable ? '' : '\n\n⚠️ This will kill all active cells immediately.';
    if (!confirm(`${verb} ALL ${radios.length} radio(s)?${warn}`)) return;
    setGlobalBusy(true);
    try {
      const r = await genieacsApi.setRfAll(enable);
      if (r.success) toast.success(`RF ${enable ? 'enabled' : 'disabled'} on ${r.affected} radio(s).`);
      else toast.error(`RF all: ${r.failures.length} failure(s). Check audit log.`);
      setTimeout(() => fetchDevices(true), 5000);
    } catch (err: any) {
      toast.error(`RF all failed: ${err?.response?.data?.error ?? err?.message}`);
    } finally { setGlobalBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Beta warning */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/40">
        <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-red-400">⚠️ Beta / Under Construction</p>
          <p className="text-xs text-red-300/80 mt-0.5">
            Tested on Baicells Nova 430i running BaiBLQ_3.0.12 firmware only —
            other models or firmware versions may not work correctly.
          </p>
        </div>
      </div>

      {/* Description */}
      <div className="nms-card border-nms-accent/30 bg-nms-accent/5">
        <div className="flex items-start gap-3">
          <Radio className="w-5 h-5 text-nms-accent mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-nms-text mb-1">Baicells eNodeB Provisioning via GenieACS</h3>
            <p className="text-xs text-nms-text-dim leading-relaxed mb-3">
              Provision Baicells LTE eNodeBs via the GenieACS TR-069 ACS. Tested on the{' '}
              <span className="text-nms-text font-medium">Baicells Nova 430i</span> running{' '}
              <span className="text-nms-text font-medium">BaiBLQ_3.0.12</span> firmware.
              Once connected, select a radio below, fill in the parameters, and click Push Config &amp; Reboot.
              A preview modal shows the exact NBI API calls before anything is sent.
            </p>
            <div className="bg-nms-bg border border-nms-border rounded-md px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-medium text-nms-text">ACS URL — enter this on the radio:</p>
              <p className="font-mono text-sm text-nms-accent select-all">
                {`http://${window.location.hostname}:7547`}
              </p>
              <p className="text-xs text-nms-text-dim">
                On the radio WebUI:{' '}
                <span className="text-nms-text">BTS Settings</span>
                {' → '}
                <span className="text-nms-text">Management Server</span>
                {' → paste the URL above into the '}
                <span className="text-nms-text">Management Server URL</span>
                {' box.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Header — buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-nms-text flex items-center gap-2">
            <Radio className="w-4 h-4 text-nms-accent" />
            Connected Radios
            {radios.length > 0 && (
              <span className="text-xs text-nms-text-dim font-normal">({radios.length})</span>
            )}
          </h2>
          <p className="text-xs text-nms-text-dim mt-0.5">Status refreshes every 30s · click a row to edit</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`http://${window.location.hostname}:7000`}
            target="_blank"
            rel="noopener noreferrer"
            className="nms-btn border border-nms-border text-nms-text-dim hover:text-nms-text hover:bg-nms-surface-2 flex items-center gap-2 text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            GenieACS UI
          </a>

          <button
            onClick={() => fetchDevices()}
            disabled={loading}
            className="nms-btn border border-nms-border text-nms-text-dim hover:text-nms-text hover:bg-nms-surface-2 flex items-center gap-2 text-sm"
          >
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </button>

          <button
            onClick={() => handleRfAll(false)}
            disabled={globalBusy || radios.length === 0}
            className="nms-btn border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-2 text-sm"
          >
            <WifiOff className="w-4 h-4" />
            RF Off — All
          </button>

          <button
            onClick={() => handleRfAll(true)}
            disabled={globalBusy || radios.length === 0}
            className="nms-btn border border-green-500/40 text-green-400 hover:bg-green-500/10 flex items-center gap-2 text-sm"
          >
            <Wifi className="w-4 h-4" />
            RF On — All
          </button>

          <button
            onClick={handleRebootAll}
            disabled={globalBusy || radios.length === 0}
            className="nms-btn border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 flex items-center gap-2 text-sm"
          >
            <RotateCw className={clsx('w-4 h-4', globalBusy && 'animate-spin')} />
            Reboot All
          </button>
        </div>
      </div>

      {/* Status dot legend */}
      <div className="flex items-center gap-4 text-xs text-nms-text-dim">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" /> RF On</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> RF Off (radio up)</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Offline</span>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Could not reach GenieACS NBI</p>
            <p className="text-xs mt-0.5 text-red-400/80">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="flex items-center justify-center h-32 text-nms-text-dim">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading devices from GenieACS…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && radios.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-nms-text-dim border border-dashed border-nms-border rounded-lg">
          <Radio className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-sm">No radios found in GenieACS</p>
          <p className="text-xs mt-1 opacity-60">Point a Baicells radio at ACS port 7547 to get started</p>
        </div>
      )}

      {/* Radio list */}
      {!loading && !error && radios.length > 0 && (
        <div className="space-y-2">
          {radios.map(radio => (
            <RadioRow key={radio.id} radio={radio} onRefresh={() => fetchDevices(true)} />
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="nms-card bg-amber-500/5 border-amber-500/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-nms-text-dim space-y-1">
            <p><span className="font-semibold text-nms-text">Push Config &amp; Reboot</span> shows a preview of the exact GenieACS NBI API calls — you can edit the JSON before confirming.</p>
            <p>Sequence: setParameterValues (all params) → reboot → setParameterValues (RF enable). RF re-enables automatically after boot.</p>
            <p>EARFCN applies to both DL and UL. Bandwidth converts to LTE resource blocks automatically (20 MHz = 100 RBs).</p>
          </div>
        </div>
      </div>
    </div>
  );
};
