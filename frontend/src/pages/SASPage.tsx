import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, Radio, Wifi, Server, Settings, RefreshCw,
  AlertCircle, CheckCircle, Activity, ScrollText, Trash2, Plus, BookOpen, X,
} from 'lucide-react';
import { sasApi } from '../api/sas';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

const SAS_BASE = `http://${window.location.hostname}:8888/sas/v1.2`;

// ─── EARFCN ↔ Hz helpers (Band 48 / CBRS, 3GPP TS 36.101) ──────────────────
// Band 48 DL: F(MHz) = 3550 + 0.1 × (EARFCN - 55240)
// EARFCN = 55240 + 10 × (F_MHz - 3550)
// EARFCN range: 55240 (3550 MHz) to 56739 (3699.9 MHz)
function earfcnToHz(earfcn: number): number {
  return Math.round((3550 + (earfcn - 55240) * 0.1) * 1e6);
}
function hzToEarfcn(hz: number): number {
  return Math.round(55240 + (hz / 1e6 - 3550) / 0.1);
}
function hzToMhz(hz: number): number { return hz / 1e6; }
function mhzToHz(mhz: number): number { return Math.round(mhz * 1e6); }

// ─── Band editor row ──────────────────────────────────────────────────────────
function BandRow({ band, onChange, onDelete }: {
  band: any;
  onChange: (updated: any) => void;
  onDelete: () => void;
}) {
  const [inputMode, setInputMode] = useState<'hz' | 'mhz' | 'earfcn'>('earfcn');

  const lowMhz     = hzToMhz(band.lowFrequency);
  const highMhz    = hzToMhz(band.highFrequency);
  const lowEarfcn  = hzToEarfcn(band.lowFrequency);
  const highEarfcn = hzToEarfcn(band.highFrequency);
  const bwMhz      = (band.highFrequency - band.lowFrequency) / 1e6;

  const handleLow = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return;
    const hz = inputMode === 'hz' ? n : inputMode === 'mhz' ? mhzToHz(n) : earfcnToHz(n);
    onChange({ ...band, lowFrequency: hz });
  };

  const handleHigh = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return;
    const hz = inputMode === 'hz' ? n : inputMode === 'mhz' ? mhzToHz(n) : earfcnToHz(n);
    onChange({ ...band, highFrequency: hz });
  };

  const dispLow  = inputMode === 'hz' ? band.lowFrequency  : inputMode === 'mhz' ? lowMhz   : lowEarfcn;
  const dispHigh = inputMode === 'hz' ? band.highFrequency : inputMode === 'mhz' ? highMhz  : highEarfcn;
  const unit     = inputMode === 'hz' ? 'Hz' : inputMode === 'mhz' ? 'MHz' : 'EARFCN';

  return (
    <div className="border border-nms-border rounded-lg p-3 space-y-3 bg-nms-surface-2">

      {/* Label row */}
      <div className="flex items-center gap-2">
        <input
          className="nms-input text-sm font-medium flex-1"
          placeholder="Label (e.g. Baicells Nova 436)"
          value={band.label}
          onChange={e => onChange({ ...band, label: e.target.value })}
        />
        <button onClick={onDelete} className="text-nms-text-dim hover:text-red-400 transition-colors shrink-0" title="Remove band">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Input mode toggle */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-nms-text-dim mr-1">Input as:</span>
        {(['earfcn', 'mhz', 'hz'] as const).map(mode => (
          <button key={mode} onClick={() => setInputMode(mode)}
            className={clsx(
              'px-2 py-0.5 rounded text-xs font-medium transition-all',
              inputMode === mode
                ? 'bg-nms-accent/15 text-nms-accent border border-nms-accent/30'
                : 'text-nms-text-dim hover:text-nms-text border border-transparent',
            )}>
            {mode.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Editable inputs */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="nms-label text-xs">Low {unit}</label>
          <input className="nms-input font-mono text-xs" type="number"
            value={dispLow} onChange={e => handleLow(e.target.value)} />
        </div>
        <div>
          <label className="nms-label text-xs">High {unit}</label>
          <input className="nms-input font-mono text-xs" type="number"
            value={dispHigh} onChange={e => handleHigh(e.target.value)} />
        </div>
        <div>
          <label className="nms-label text-xs">Max Grant BW (MHz)</label>
          <input className="nms-input font-mono text-xs" type="number"
            value={band.maxBandwidthMhz}
            onChange={e => onChange({ ...band, maxBandwidthMhz: Number(e.target.value) })} />
        </div>
      </div>

      {/* Read-only computed values — always visible regardless of input mode */}
      <div className="rounded-md bg-nms-bg border border-nms-border/60 px-3 py-2 space-y-1.5">
        <div className="grid grid-cols-3 gap-x-4">
          <div>
            <p className="text-xs text-nms-text-dim mb-0.5">EARFCN</p>
            <p className="font-mono text-xs text-nms-text">{lowEarfcn} – {highEarfcn}</p>
          </div>
          <div>
            <p className="text-xs text-nms-text-dim mb-0.5">MHz</p>
            <p className="font-mono text-xs text-nms-text">{lowMhz.toFixed(1)} – {highMhz.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-xs text-nms-text-dim mb-0.5">Hz (sent to radio)</p>
            <p className="font-mono text-xs text-nms-text break-all">{band.lowFrequency.toLocaleString()} – {band.highFrequency.toLocaleString()}</p>
          </div>
        </div>
        <div className="border-t border-nms-border/40 pt-1">
          <p className="text-xs text-nms-text-dim">
            Band width: <span className="text-nms-text font-mono">{bwMhz.toFixed(1)} MHz</span>
            &nbsp;·&nbsp;
            Max grant: <span className="text-nms-text font-mono">{band.maxBandwidthMhz} MHz</span>
            &nbsp;·&nbsp;
            Grants fit in band: <span className="text-nms-text font-mono">{Math.floor(bwMhz / band.maxBandwidthMhz)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── EARFCN Reference modal ──────────────────────────────────────────────────
function EarfcnReferenceModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 bg-nms-bg border border-nms-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nms-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-nms-text">EARFCN / Frequency Reference</h2>
              <p className="text-xs text-nms-text-dim">3GPP TS 36.101 — Band 48 (CBRS 3550–3700 MHz)</p>
            </div>
          </div>
          <button onClick={onClose} className="text-nms-text-dim hover:text-nms-text transition-colors p-1 rounded-md hover:bg-nms-surface">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <EarfcnReference />
        </div>
      </div>
    </div>
  );
}

// ─── EARFCN Reference content ─────────────────────────────────────────────────
function EarfcnReference() {
  const [calcEarfcn, setCalcEarfcn] = useState(56060);
  const calcMhz = 3550 + (calcEarfcn - 55240) * 0.1;
  const calcHz  = Math.round(calcMhz * 1e6);

  const [calcMhzIn, setCalcMhzIn] = useState(3632);
  const calcEarfcnOut = Math.round(55240 + (calcMhzIn - 3550) * 10);

  const EXAMPLES = [
    { earfcn: 55240, mhz: 3550.0, note: 'CBRS band start' },
    { earfcn: 55340, mhz: 3560.0, note: 'Baicells low end' },
    { earfcn: 55540, mhz: 3580.0, note: '' },
    { earfcn: 55990, mhz: 3625.0, note: '' },
    { earfcn: 56060, mhz: 3632.0, note: 'Baicells example' },
    { earfcn: 56190, mhz: 3645.0, note: '' },
    { earfcn: 56490, mhz: 3675.0, note: '' },
    { earfcn: 56640, mhz: 3690.0, note: 'Baicells high end' },
    { earfcn: 56739, mhz: 3699.9, note: 'CBRS band end' },
  ];

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-nms-text">EARFCN / Frequency Reference</h2>
          <p className="text-xs text-nms-text-dim">3GPP TS 36.101 — Band 48 (CBRS 3550–3700 MHz)</p>
        </div>
      </div>

      {/* Formulas */}
      <div className="nms-card space-y-5">
        <h3 className="text-xs font-semibold text-nms-text-dim uppercase tracking-wider">Conversion Formulas</h3>

        {/* EARFCN → Frequency */}
        <div className="space-y-2">
          <p className="text-xs text-nms-text-dim">EARFCN → Frequency</p>
          <div className="bg-nms-surface rounded-lg px-4 py-3 border border-nms-border">
            {/* F_DL = F_DL,low + 0.1 × (N_DL − N_Offs-DL) */}
            <div className="flex items-center gap-1.5 flex-wrap font-mono text-sm">
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">DL</sub>
              <span className="text-nms-text-dim mx-1">=</span>
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">DL,low</sub>
              <span className="text-nms-text mx-1">+</span>
              <span className="text-amber-400">0.1</span>
              <span className="text-nms-text-dim mx-1">×</span>
              <span className="text-nms-text">(</span>
              <span className="text-green-400 italic">N</span>
              <sub className="text-green-300 text-xs -ml-1">DL</sub>
              <span className="text-nms-text-dim mx-1">−</span>
              <span className="text-green-400 italic">N</span>
              <sub className="text-green-300 text-xs -ml-1">Offs‑DL</sub>
              <span className="text-nms-text">)</span>
            </div>
            <div className="mt-2 pt-2 border-t border-nms-border/50 flex items-center gap-1.5 flex-wrap font-mono text-sm">
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">MHz</sub>
              <span className="text-nms-text-dim mx-1">=</span>
              <span className="text-amber-400">3550</span>
              <span className="text-nms-text mx-1">+</span>
              <span className="text-amber-400">0.1</span>
              <span className="text-nms-text-dim mx-1">×</span>
              <span className="text-nms-text">(</span>
              <span className="text-green-400">EARFCN</span>
              <span className="text-nms-text-dim mx-1">−</span>
              <span className="text-amber-400">55240</span>
              <span className="text-nms-text">)</span>
            </div>
          </div>
          <p className="text-xs text-nms-text-dim pl-1">
            Where <span className="font-mono text-amber-400">3550</span> = F<sub>DL,low</sub> (MHz),&nbsp;
            <span className="font-mono text-amber-400">55240</span> = N<sub>Offs‑DL</sub>,&nbsp;
            each step = <span className="font-mono text-amber-400">0.1 MHz = 100 kHz</span>
          </p>
        </div>

        {/* Frequency → EARFCN */}
        <div className="space-y-2">
          <p className="text-xs text-nms-text-dim">Frequency → EARFCN</p>
          <div className="bg-nms-surface rounded-lg px-4 py-3 border border-nms-border">
            <div className="flex items-center gap-1.5 flex-wrap font-mono text-sm">
              <span className="text-green-400 italic">N</span>
              <sub className="text-green-300 text-xs -ml-1">DL</sub>
              <span className="text-nms-text-dim mx-1">=</span>
              <span className="text-green-400 italic">N</span>
              <sub className="text-green-300 text-xs -ml-1">Offs‑DL</sub>
              <span className="text-nms-text mx-1">+</span>
              <span className="text-amber-400">10</span>
              <span className="text-nms-text-dim mx-1">×</span>
              <span className="text-nms-text">(</span>
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">DL</sub>
              <span className="text-nms-text-dim mx-1">−</span>
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">DL,low</sub>
              <span className="text-nms-text">)</span>
            </div>
            <div className="mt-2 pt-2 border-t border-nms-border/50 flex items-center gap-1.5 flex-wrap font-mono text-sm">
              <span className="text-green-400">EARFCN</span>
              <span className="text-nms-text-dim mx-1">=</span>
              <span className="text-amber-400">55240</span>
              <span className="text-nms-text mx-1">+</span>
              <span className="text-amber-400">10</span>
              <span className="text-nms-text-dim mx-1">×</span>
              <span className="text-nms-text">(</span>
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">MHz</sub>
              <span className="text-nms-text-dim mx-1">−</span>
              <span className="text-amber-400">3550</span>
              <span className="text-nms-text">)</span>
            </div>
          </div>
        </div>

        {/* MHz → Hz */}
        <div className="space-y-2">
          <p className="text-xs text-nms-text-dim">MHz → Hz (what the SAS sends to the radio)</p>
          <div className="bg-nms-surface rounded-lg px-4 py-3 border border-nms-border">
            <div className="flex items-center gap-1.5 flex-wrap font-mono text-sm">
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">Hz</sub>
              <span className="text-nms-text-dim mx-1">=</span>
              <span className="text-indigo-400 italic">F</span>
              <sub className="text-indigo-300 text-xs -ml-1">MHz</sub>
              <span className="text-nms-text-dim mx-1">×</span>
              <span className="text-amber-400">10</span>
              <sup className="text-amber-300 text-xs">6</sup>
            </div>
          </div>
          <p className="text-xs text-nms-text-dim pl-1">
            Example: <span className="font-mono text-nms-text">3632 MHz × 10⁶ = 3,632,000,000 Hz</span>
          </p>
        </div>
      </div>

      {/* Interactive calculators */}
      <div className="grid grid-cols-2 gap-4">

        {/* EARFCN → MHz/Hz */}
        <div className="nms-card space-y-3">
          <h3 className="text-xs font-semibold text-nms-text-dim uppercase tracking-wider">EARFCN → Frequency</h3>
          <div>
            <label className="nms-label text-xs">EARFCN (Band 48)</label>
            <input className="nms-input font-mono" type="number"
              value={calcEarfcn}
              onChange={e => setCalcEarfcn(Number(e.target.value))}
              min={55240} max={56739} />
            <p className="text-xs text-nms-text-dim mt-1">Valid range: 55240 – 56739</p>
          </div>
          <div className="bg-nms-surface rounded-lg px-3 py-2 border border-nms-border space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-nms-text-dim">MHz</span>
              <span className="font-mono text-nms-text">{calcMhz.toFixed(1)} MHz</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-nms-text-dim">Hz (SAS grant)</span>
              <span className="font-mono text-nms-text">{calcHz.toLocaleString()} Hz</span>
            </div>
            <div className="flex justify-between text-xs border-t border-nms-border/40 pt-1 mt-1">
              <span className="text-nms-text-dim">Calculation</span>
              <span className="font-mono text-nms-text-dim text-xs">3550 + 0.1×({calcEarfcn}−55240)</span>
            </div>
          </div>
        </div>

        {/* MHz → EARFCN */}
        <div className="nms-card space-y-3">
          <h3 className="text-xs font-semibold text-nms-text-dim uppercase tracking-wider">Frequency → EARFCN</h3>
          <div>
            <label className="nms-label text-xs">Frequency (MHz)</label>
            <input className="nms-input font-mono" type="number"
              value={calcMhzIn}
              onChange={e => setCalcMhzIn(Number(e.target.value))}
              min={3550} max={3700} step={0.1} />
            <p className="text-xs text-nms-text-dim mt-1">Valid range: 3550 – 3700 MHz</p>
          </div>
          <div className="bg-nms-surface rounded-lg px-3 py-2 border border-nms-border space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-nms-text-dim">EARFCN</span>
              <span className="font-mono text-nms-text">{calcEarfcnOut}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-nms-text-dim">Hz</span>
              <span className="font-mono text-nms-text">{mhzToHz(calcMhzIn).toLocaleString()} Hz</span>
            </div>
            <div className="flex justify-between text-xs border-t border-nms-border/40 pt-1 mt-1">
              <span className="text-nms-text-dim">Calculation</span>
              <span className="font-mono text-nms-text-dim text-xs">55240 + 10×({calcMhzIn}−3550)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Reference table */}
      <div className="nms-card space-y-3">
        <h3 className="text-xs font-semibold text-nms-text-dim uppercase tracking-wider">Band 48 Reference Points</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-nms-border text-nms-text-dim">
              <th className="text-left py-2 pr-4">EARFCN</th>
              <th className="text-left py-2 pr-4">MHz</th>
              <th className="text-left py-2 pr-4">Hz</th>
              <th className="text-left py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map(ex => (
              <tr key={ex.earfcn} className="border-b border-nms-border/50 hover:bg-nms-surface-2">
                <td className="py-1.5 pr-4 font-mono text-nms-accent">{ex.earfcn}</td>
                <td className="py-1.5 pr-4 font-mono text-nms-text">{ex.mhz.toFixed(1)}</td>
                <td className="py-1.5 pr-4 font-mono text-nms-text-dim">{mhzToHz(ex.mhz).toLocaleString()}</td>
                <td className="py-1.5 text-nms-text-dim">{ex.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SAS grant workflow */}
      <div className="nms-card space-y-3">
        <h3 className="text-xs font-semibold text-nms-text-dim uppercase tracking-wider">SAS Grant Frequency Workflow</h3>
        <div className="space-y-2">
          {[
            { n: 1, text: 'Radio sends grant request with lowFrequency / highFrequency in Hz' },
            { n: 2, text: 'SAS matches request against configured frequency bands' },
            { n: 3, text: 'SAS clamps grant to band\'s maxBandwidthMhz (e.g. 20 MHz)' },
            { n: 4, text: 'SAS returns approved lowFrequency / highFrequency in Hz' },
            { n: 5, text: 'Radio maps Hz back to EARFCN internally for RF tuning' },
            { n: 6, text: 'Radio heartbeats every heartbeatInterval seconds to keep grant alive' },
          ].map(step => (
            <div key={step.n} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-nms-accent/20 border border-nms-accent/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-nms-accent">{step.n}</span>
              </div>
              <p className="text-xs text-nms-text-dim pt-0.5">{step.text}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Frequency Spectrum Chart ──────────────────────────────────────────────────────

const SLOT_COLORS = [
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#84cc16', // lime
];

function SpectrumChart({ slots, bandLow, bandHigh, slotWidthHz }: {
  slots:       Array<{ low: number; high: number; earfcn: number; cbsdId?: string; serial?: string; fccId?: string; state?: string }>;
  bandLow:     number;
  bandHigh:    number;
  slotWidthHz: number;
}) {
  const bandWidthHz = bandHigh - bandLow;
  const bandMhz     = bandWidthHz / 1e6;
  const lowMhz      = bandLow  / 1e6;
  const highMhz     = bandHigh / 1e6;

  // Map cbsdId -> color index for consistent coloring
  const cbsdColorMap = new Map<string, number>();
  let colorIdx = 0;
  for (const s of slots) {
    if (s.cbsdId && !cbsdColorMap.has(s.cbsdId)) {
      cbsdColorMap.set(s.cbsdId, colorIdx % SLOT_COLORS.length);
      colorIdx++;
    }
  }

  const usedSlots   = slots.filter(s => s.cbsdId);
  const unusedSlots = slots.filter(s => !s.cbsdId);

  return (
    <div className="space-y-3">
      {/* Chart bar */}
      <div className="relative h-14 rounded-lg overflow-hidden bg-nms-surface border border-nms-border">
        {/* Unused slot hatching */}
        {unusedSlots.map((s, i) => {
          const leftPct  = ((s.low  - bandLow) / bandWidthHz) * 100;
          const widthPct = ((s.high - s.low)   / bandWidthHz) * 100;
          return (
            <div key={i} className="absolute inset-y-0 flex items-center justify-center"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
              <div className="w-full h-full opacity-20"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, #6b7280 0, #6b7280 1px, transparent 0, transparent 50%)', backgroundSize: '6px 6px' }} />
            </div>
          );
        })}

        {/* Used slots */}
        {usedSlots.map((s) => {
          const leftPct   = ((s.low  - bandLow) / bandWidthHz) * 100;
          const widthPct  = ((s.high - s.low)   / bandWidthHz) * 100;
          const color     = SLOT_COLORS[cbsdColorMap.get(s.cbsdId!)! % SLOT_COLORS.length];
          const isAuth    = s.state === 'AUTHORIZED';
          const label     = s.serial ? s.serial.slice(-6) : s.cbsdId?.slice(0, 6);
          return (
            <div key={s.cbsdId} className="absolute inset-y-0 flex flex-col items-center justify-center px-1 overflow-hidden"
              style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: color + '33', borderLeft: `2px solid ${color}`, borderRight: `2px solid ${color}` }}
              title={`${s.serial ?? s.cbsdId}\n${(s.low/1e6).toFixed(1)}–${(s.high/1e6).toFixed(1)} MHz\nEARFCN ${s.earfcn}\n${s.state}`}>
              <span className="text-xs font-bold truncate w-full text-center" style={{ color }}>{label}</span>
              <span className="text-xs font-mono truncate w-full text-center" style={{ color: color + 'cc' }}>{(s.low/1e6).toFixed(0)}–{(s.high/1e6).toFixed(0)}</span>
              {isAuth && <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.9)]" />}
            </div>
          );
        })}

        {/* Slot divider lines */}
        {slots.slice(0, -1).map((s, i) => {
          const leftPct = ((s.high - bandLow) / bandWidthHz) * 100;
          return <div key={i} className="absolute inset-y-0 w-px bg-nms-border/60" style={{ left: `${leftPct}%` }} />;
        })}
      </div>

      {/* X-axis labels */}
      <div className="relative h-4">
        {slots.map((s, i) => {
          const centerPct = ((s.low + s.high) / 2 - bandLow) / bandWidthHz * 100;
          return (
            <span key={i} className="absolute text-xs font-mono text-nms-text-dim -translate-x-1/2"
              style={{ left: `${centerPct}%` }}>
              {s.earfcn}
            </span>
          );
        })}
        <span className="absolute left-0 text-xs font-mono text-nms-text-dim">{lowMhz.toFixed(0)}</span>
        <span className="absolute right-0 text-xs font-mono text-nms-text-dim translate-x-0">{highMhz.toFixed(0)} MHz</span>
      </div>

      {/* Legend */}
      {usedSlots.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {usedSlots.map(s => {
            const color = SLOT_COLORS[cbsdColorMap.get(s.cbsdId!)! % SLOT_COLORS.length];
            return (
              <div key={s.cbsdId} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color + '55', border: `1.5px solid ${color}` }} />
                <span className="text-xs text-nms-text-dim">
                  {s.serial ? s.serial.slice(-8) : s.cbsdId?.slice(0, 8)}
                  <span className="font-mono ml-1 text-nms-text-dim/60">
                    {(s.low/1e6).toFixed(1)}–{(s.high/1e6).toFixed(1)} MHz
                  </span>
                  {s.state === 'AUTHORIZED' && <span className="ml-1 text-green-400">●</span>}
                </span>
              </div>
            );
          })}
          {unusedSlots.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-nms-text-dim/20 border border-nms-border" />
              <span className="text-xs text-nms-text-dim">{unusedSlots.length} unassigned slot{unusedSlots.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Slot detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-nms-border text-nms-text-dim">
              <th className="text-left py-1.5 pr-4">Slot</th>
              <th className="text-left py-1.5 pr-4">Frequency Range</th>
              <th className="text-left py-1.5 pr-4">EARFCN</th>
              <th className="text-left py-1.5 pr-4">Assigned To</th>
              <th className="text-left py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s, i) => {
              const color = s.cbsdId ? SLOT_COLORS[cbsdColorMap.get(s.cbsdId)! % SLOT_COLORS.length] : undefined;
              return (
                <tr key={i} className="border-b border-nms-border/50 hover:bg-nms-surface-2">
                  <td className="py-1.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      {color && <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color + '55', border: `1.5px solid ${color}` }} />}
                      <span className="font-mono text-nms-text-dim">Slot {i + 1}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-4 font-mono text-nms-text">
                    {(s.low/1e6).toFixed(1)}–{(s.high/1e6).toFixed(1)} MHz
                  </td>
                  <td className="py-1.5 pr-4 font-mono text-nms-accent">{s.earfcn}</td>
                  <td className="py-1.5 pr-4 font-mono">
                    {s.serial
                      ? <span style={{ color }}>{s.serial}</span>
                      : <span className="text-nms-text-dim italic">unassigned</span>}
                  </td>
                  <td className="py-1.5">
                    {s.state
                      ? <span className={clsx('inline-flex items-center gap-1',
                          s.state === 'AUTHORIZED' ? 'text-green-400' : 'text-amber-400')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full',
                            s.state === 'AUTHORIZED' ? 'bg-green-400' : 'bg-amber-400')} />
                          {s.state}
                        </span>
                      : <span className="text-nms-text-dim">free</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-nms-text-dim">
        Band: <span className="font-mono text-nms-text">{lowMhz.toFixed(1)}–{highMhz.toFixed(1)} MHz ({bandMhz.toFixed(0)} MHz)</span>
        &nbsp;·&nbsp;
        Slot width: <span className="font-mono text-nms-text">{(slotWidthHz/1e6).toFixed(0)} MHz</span>
        &nbsp;·&nbsp;
        Total slots: <span className="font-mono text-nms-text">{slots.length}</span>
        &nbsp;·&nbsp;
        In use: <span className="font-mono text-nms-text">{usedSlots.length}</span>
      </p>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number | string; icon: any; color: string;
}) {
  return (
    <div className="nms-card flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-nms-text">{value}</p>
        <p className="text-xs text-nms-text-dim">{label}</p>
      </div>
    </div>
  );
}

function GrantStateDot({ state }: { state: string }) {
  return (
    <span className={clsx(
      'inline-block w-2 h-2 rounded-full mr-1.5',
      state === 'AUTHORIZED' && 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]',
      state === 'GRANTED'    && 'bg-amber-400',
      state === 'TERMINATED' && 'bg-red-500',
    )} />
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function SASPage() {
  const [stats, setStats]     = useState<any>(null);
  const [cbsds, setCbsds]     = useState<any[]>([]);
  const [config, setConfig]   = useState<any>(null);
  const [slots, setSlots]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'dashboard' | 'config' | 'api' | 'logs'>('dashboard');
  const [saving, setSaving]   = useState(false);
  const [cfgForm, setCfgForm] = useState<any>(null);
  const [showRefModal, setShowRefModal] = useState(false);

  const [paused, setPaused]   = useState(false);

  // Fetch pause status on load
  useEffect(() => {
    sasApi.getStatus().then(s => setPaused(s.paused)).catch(() => {});
  }, []);

  const [cbsdSort, setCbsdSort] = useState<'asc' | 'desc' | null>('asc');

  const sortedCbsds = cbsdSort === null ? cbsds : [...cbsds].sort((a, b) => {
    const ag = (a.grants ?? []).find((g: any) => g.state === 'AUTHORIZED' || g.state === 'GRANTED');
    const bg = (b.grants ?? []).find((g: any) => g.state === 'AUTHORIZED' || g.state === 'GRANTED');
    const aLow = ag?.operationParam?.operationFrequencyRange?.lowFrequency ?? Infinity;
    const bLow = bg?.operationParam?.operationFrequencyRange?.lowFrequency ?? Infinity;
    return cbsdSort === 'asc' ? aLow - bLow : bLow - aLow;
  });
  const [logs, setLogs]               = useState<string>('');
  const [logLines, setLogLines]       = useState(200);
  const [logsLoading, setLogsLoading] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [s, c, cfg, sl] = await Promise.all([
        sasApi.getStats(),
        sasApi.getCbsds(),
        sasApi.getConfig(),
        sasApi.getSlots(),
      ]);
      setStats(s);
      setCbsds(c.cbsds ?? []);
      setConfig(cfg);
      setSlots(sl);
      setCfgForm((prev: any) => prev ?? cfg);
    } catch {
      if (!silent) toast.error('Failed to load SAS data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const loadLogs = useCallback(async (silent = false) => {
    if (!silent) setLogsLoading(true);
    try {
      const data = await sasApi.getLogs(logLines);
      setLogs(data);
      setTimeout(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      }, 50);
    } catch {
      if (!silent) setLogs('Failed to fetch logs');
    } finally {
      if (!silent) setLogsLoading(false);
    }
  }, [logLines]);

  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab, logLines]);
  useEffect(() => {
    if (tab !== 'logs') return;
    const t = setInterval(() => loadLogs(true), 5000);
    return () => clearInterval(t);
  }, [tab, loadLogs]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const updated = await sasApi.updateConfig(cfgForm);
      setConfig(updated);
      setCfgForm(updated);
      toast.success('SAS configuration saved');
    } catch {
      toast.error('Failed to save configuration');
    } finally { setSaving(false); }
  };

  const addBand = () => {
    const newBand = { id: `band-${Date.now()}`, label: 'New Band', lowFrequency: 3619000000, highFrequency: 3700000000, maxBandwidthMhz: 20 };
    setCfgForm((f: any) => ({ ...f, frequencyBands: [...(f.frequencyBands ?? []), newBand] }));
  };
  const updateBand = (index: number, updated: any) => {
    setCfgForm((f: any) => ({ ...f, frequencyBands: f.frequencyBands.map((b: any, i: number) => i === index ? updated : b) }));
  };
  const deleteBand = (index: number) => {
    setCfgForm((f: any) => ({ ...f, frequencyBands: f.frequencyBands.filter((_: any, i: number) => i !== index) }));
  };

  const ENDPOINTS = [
    { method: 'POST', path: '/registration',    desc: 'Register a CBSD with the SAS' },
    { method: 'POST', path: '/spectrumInquiry', desc: 'Query available CBRS spectrum' },
    { method: 'POST', path: '/grant',           desc: 'Request authorization to transmit' },
    { method: 'POST', path: '/heartbeat',       desc: 'Keep grant alive, get transmit expire time' },
    { method: 'POST', path: '/relinquishment',  desc: 'Voluntarily give up a grant' },
    { method: 'POST', path: '/deregistration',  desc: 'Remove CBSD from the SAS' },
  ];

  const TAB_LABELS: Record<string, string> = {
    dashboard: 'Dashboard',
    config:    'Configuration',
    api:       'API Reference',
    logs:      'Logs',
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* EARFCN Reference modal */}
      {showRefModal && <EarfcnReferenceModal onClose={() => setShowRefModal(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-nms-text">Spectrum Access System</h1>
            <p className="text-xs text-nms-text-dim">WinnForum CBRS SAS-CBSD Interface — WINNF-TS-0016 V1.2.7</p>
          </div>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="nms-btn border border-nms-border text-nms-text-dim hover:text-nms-text flex items-center gap-2 text-sm">
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
        <button
          onClick={async () => {
            if (!confirm('Clear all SAS grants and CBSDs?\n\nThis deletes all grants and registered CBSDs from the database. Radios will re-register on next contact.')) return;
            try {
              const r = await sasApi.reset();
              toast.success(`Cleared — deleted ${r.deletedGrants} grants, ${r.deletedCbsds} CBSDs`);
              load(true);
            } catch { toast.error('Clear failed'); }
          }}
          className="nms-btn border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 flex items-center gap-2 text-sm">
          <Trash2 className="w-4 h-4" />
          Clear DB
        </button>
        <button
          onClick={async () => {
            try {
              if (paused) {
                await sasApi.resume();
                setPaused(false);
                toast.success('SAS resumed — radios will re-register');
              } else {
                await sasApi.pause();
                setPaused(true);
                toast.success('SAS paused — radios will stop transmitting');
              }
            } catch { toast.error('Failed to change SAS state'); }
          }}
          className={clsx(
            'nms-btn border flex items-center gap-2 text-sm',
            paused
              ? 'border-green-500/40 text-green-400 hover:bg-green-500/10'
              : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
          )}>
          {paused ? <>▶ Resume SAS</> : <>⏸ Pause SAS</>}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-nms-surface rounded-lg p-1 w-fit">
        {(['dashboard', 'config', 'api', 'logs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
              tab === t
                ? 'bg-nms-accent/10 text-nms-accent border border-nms-accent/20'
                : 'text-nms-text-dim hover:text-nms-text',
            )}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* ── Dashboard ── */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {paused && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-400">⏸ SAS is PAUSED</p>
                <p className="text-xs text-red-300/70">All radio requests are returning DEREGISTER. Radios have stopped transmitting. Click Resume SAS to restore normal operation.</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Registered CBSDs"  value={stats?.registeredCbsds  ?? '—'} icon={Radio}       color="bg-blue-500/80" />
            <StatCard label="Active Grants"      value={stats?.activeGrants     ?? '—'} icon={Wifi}        color="bg-amber-500/80" />
            <StatCard label="Authorized (TX On)" value={stats?.authorizedGrants ?? '—'} icon={CheckCircle} color="bg-green-500/80" />
          </div>

          <div className="nms-card space-y-3">
            <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
              <Wifi className="w-4 h-4 text-nms-accent" />
              Frequency Spectrum
            </h2>
            {slots && slots.slots?.length > 0
              ? <SpectrumChart slots={slots.slots} bandLow={slots.bandLow} bandHigh={slots.bandHigh} slotWidthHz={slots.slotWidthHz} />
              : <p className="text-xs text-nms-text-dim py-4 text-center">No frequency bands configured — add a band in the Configuration tab</p>
            }
          </div>

          <div className="nms-card space-y-3">
            <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
              <Activity className="w-4 h-4 text-nms-accent" />
              Registered CBSDs
            </h2>
            {loading && <div className="flex items-center justify-center h-24 text-nms-text-dim"><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…</div>}
            {!loading && cbsds.length === 0 && (
              <div className="flex flex-col items-center justify-center h-24 text-nms-text-dim border border-dashed border-nms-border rounded-lg">
                <Shield className="w-7 h-7 mb-1.5 opacity-30" />
                <p className="text-sm">No CBSDs registered yet</p>
              </div>
            )}
            {!loading && cbsds.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-nms-border text-nms-text-dim">
                      <th className="text-left py-2 pr-4">CBSD ID</th>
                      <th className="text-left py-2 pr-4">FCC ID</th>
                      <th className="text-left py-2 pr-4">Serial</th>
                      <th className="text-left py-2 pr-4">Category</th>
                      <th className="text-left py-2 pr-4">Assigned Channel</th>
                      <th className="text-left py-2 pr-4">
                        <button
                          onClick={() => setCbsdSort(s => s === 'asc' ? 'desc' : 'asc')}
                          className="flex items-center gap-1 hover:text-nms-accent transition-colors"
                          title="Sort by EARFCN">
                          EARFCN
                          <span className="text-nms-text-dim">
                            {cbsdSort === 'asc' ? '↑' : cbsdSort === 'desc' ? '↓' : '⇅'}
                          </span>
                        </button>
                      </th>
                      <th className="text-left py-2 pr-4">Grants</th>
                      <th className="text-left py-2 pr-4">Last Seen</th>
                      <th className="text-left py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCbsds.map(c => {
                      // Find active grant for this CBSD
                      const activeGrant = (c.grants ?? []).find((g: any) => g.state === 'AUTHORIZED' || g.state === 'GRANTED');
                      const grantLow    = activeGrant?.operationParam?.operationFrequencyRange?.lowFrequency;
                      const grantHigh   = activeGrant?.operationParam?.operationFrequencyRange?.highFrequency;
                      const earfcn      = grantLow && grantHigh
                        ? Math.round(55240 + (((grantLow + grantHigh) / 2) / 1e6 - 3550) * 10)
                        : null;
                      const channelStr  = grantLow && grantHigh
                        ? `${(grantLow/1e6).toFixed(1)}–${(grantHigh/1e6).toFixed(1)} MHz`
                        : null;
                      // Match slot color
                      const slotEntry   = slots?.slots?.find((s: any) => s.cbsdId === c.cbsdId);
                      const slotIdx     = slotEntry ? slots?.slots?.filter((s: any) => s.cbsdId).indexOf(slotEntry) : -1;
                      const color       = slotIdx >= 0 ? SLOT_COLORS[slotIdx % SLOT_COLORS.length] : undefined;
                      return (
                      <tr key={c.cbsdId} className="border-b border-nms-border/50 hover:bg-nms-surface-2">
                        <td className="py-2 pr-4 font-mono text-nms-accent">{c.cbsdId.slice(0, 8)}…</td>
                        <td className="py-2 pr-4 font-mono">{c.fccId}</td>
                        <td className="py-2 pr-4 font-mono text-nms-text-dim">{c.cbsdSerialNumber}</td>
                        <td className="py-2 pr-4">{c.cbsdCategory ?? 'A'}</td>
                        <td className="py-2 pr-4 font-mono">
                          {channelStr
                            ? <span style={{ color }}>{channelStr}</span>
                            : <span className="text-nms-text-dim">—</span>}
                        </td>
                        <td className="py-2 pr-4 font-mono">
                          {earfcn
                            ? <span className="text-nms-accent">{earfcn}</span>
                            : <span className="text-nms-text-dim">—</span>}
                        </td>
                        <td className="py-2 pr-4">
                          {(c.grants ?? []).length === 0
                            ? <span className="text-nms-text-dim">—</span>
                            : (c.grants as any[]).map((g: any) => (
                              <span key={g.grantId} className="inline-flex items-center gap-1 mr-2">
                                <GrantStateDot state={g.state} />
                                <span className={clsx(
                                  g.state === 'AUTHORIZED' && 'text-green-400',
                                  g.state === 'GRANTED'    && 'text-amber-400',
                                  g.state === 'TERMINATED' && 'text-red-400',
                                )}>{g.state}</span>
                                <button onClick={async () => {
                                  if (!confirm(`Delete grant ${g.grantId.slice(0,8)}…?`)) return;
                                  try { await sasApi.deleteGrant(g.grantId); toast.success('Grant deleted'); load(true); }
                                  catch { toast.error('Failed to delete grant'); }
                                }} className="text-nms-text-dim hover:text-red-400 transition-colors ml-0.5" title="Delete grant">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </span>
                            ))
                          }
                        </td>
                        <td className="py-2 pr-4 text-nms-text-dim">{c.lastSeen ? new Date(c.lastSeen).toLocaleTimeString() : '—'}</td>
                        <td className="py-2">
                          <button onClick={async () => {
                            if (!confirm(`Remove CBSD ${c.cbsdSerialNumber} and all its grants?`)) return;
                            try { await sasApi.deleteCbsd(c.cbsdId); toast.success('CBSD removed'); load(true); }
                            catch { toast.error('Failed to remove CBSD'); }
                          }} className="text-nms-text-dim hover:text-red-400 transition-colors" title="Remove CBSD">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="nms-card bg-nms-accent/5 border-nms-accent/20">
            <p className="text-xs font-semibold text-nms-text mb-2 flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-nms-accent" />
              SAS Endpoint — configure this on your CBSDs
            </p>
            <p className="font-mono text-sm text-nms-accent select-all bg-nms-bg border border-nms-border rounded px-3 py-2">
              {SAS_BASE.replace('/v1.2', '')}
            </p>
            <p className="text-xs text-nms-text-dim mt-1.5">
              CBSDs append the method path — e.g. <span className="font-mono text-nms-text">{SAS_BASE}/registration</span>
            </p>
          </div>
        </div>
      )}

      {/* ── Config ── */}
      {tab === 'config' && cfgForm && (
        <div className="space-y-5 max-w-2xl">
          <div className="nms-card space-y-4">
            <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
              <Settings className="w-4 h-4 text-nms-accent" />
              Global Settings
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="nms-label">Max EIRP GAA (dBm/MHz)</label>
                <input className="nms-input font-mono" type="number" value={cfgForm.maxEirpGAA}
                  onChange={e => setCfgForm((f: any) => ({ ...f, maxEirpGAA: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="nms-label">Heartbeat Interval (sec)</label>
                <input className="nms-input font-mono" type="number" value={cfgForm.heartbeatInterval}
                  onChange={e => setCfgForm((f: any) => ({ ...f, heartbeatInterval: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="nms-label">Grant Expire (hours)</label>
                <input className="nms-input font-mono" type="number" value={cfgForm.grantExpireHours}
                  onChange={e => setCfgForm((f: any) => ({ ...f, grantExpireHours: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="nms-label">Default Max BW (MHz)</label>
                <input className="nms-input font-mono" type="number" value={cfgForm.defaultGrantBandwidthMhz ?? 20}
                  onChange={e => setCfgForm((f: any) => ({ ...f, defaultGrantBandwidthMhz: Number(e.target.value) }))} />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" checked={cfgForm.autoApprove}
                onChange={e => setCfgForm((f: any) => ({ ...f, autoApprove: e.target.checked }))}
                className="w-4 h-4 rounded border-nms-border bg-nms-surface text-nms-accent" />
              <span className="text-sm text-nms-text group-hover:text-nms-accent transition-colors">Auto-approve all grants</span>
              <span className="text-xs text-nms-text-dim">(recommended for private CBRS)</span>
            </label>
          </div>

          <div className="nms-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
                <Wifi className="w-4 h-4 text-nms-accent" />
                Auto-Configure Frequency Band
              </h2>
            </div>
            <p className="text-xs text-nms-text-dim">
              Replaces all frequency bands with a safe, non-overlapping 20 MHz channel for the selected band.
              Band boundaries are strictly enforced — grants will never cross into another band.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { band: 42, label: 'Band 42', channel: '3400–3420 MHz', note: 'Pure Band 42 — no overlap with B43/B48', low: 3400000000, high: 3420000000, color: 'border-blue-500/30 hover:bg-blue-500/5', labelColor: 'text-blue-400' },
                { band: 43, label: 'Band 43', channel: '3600–3620 MHz', note: 'Pure Band 43 — starts above Band 48 overlap zone', low: 3600000000, high: 3620000000, color: 'border-purple-500/30 hover:bg-purple-500/5', labelColor: 'text-purple-400' },
                { band: 48, label: 'Band 48 / CBRS', channel: '3560–3580 MHz', note: 'Safe zone: below 3600 MHz so radio uses B48 not B43', low: 3560000000, high: 3580000000, color: 'border-nms-accent/30 hover:bg-nms-accent/5', labelColor: 'text-nms-accent' },
              ].map(preset => (
                <button key={preset.band} type="button"
                  onClick={() => {
                    if (!confirm(`Replace all frequency bands with Band ${preset.band} preset?\n\nChannel: ${preset.channel}\n${preset.note}\n\nThis removes existing bands.`)) return;
                    setCfgForm((f: any) => ({ ...f, frequencyBands: [{ id: `band-${Date.now()}`, label: `${preset.label} — ${preset.channel}`, lowFrequency: preset.low, highFrequency: preset.high, maxBandwidthMhz: 20 }] }));
                    toast.success(`Band ${preset.band} preset applied — click Save to activate`);
                  }}
                  className={`text-left p-3 rounded-lg border transition-colors ${preset.color}`}>
                  <p className={`text-sm font-semibold mb-1 ${preset.labelColor}`}>{preset.label}</p>
                  <p className="text-xs text-nms-text font-mono">{preset.channel}</p>
                  <p className="text-xs text-nms-text-dim mt-1">{preset.note}</p>
                </button>
              ))}
            </div>
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300/80">
                After applying a preset, also update <span className="font-mono text-amber-300">reqLow/reqHighFrequency</span> and{' '}
                <span className="font-mono text-amber-300">PreferredFrequency</span> on each radio via the Baicells ACS module Auto-fill button.
              </p>
            </div>
          </div>

          <div className="nms-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
                <Wifi className="w-4 h-4 text-nms-accent" />
                Frequency Bands
                <span className="text-xs text-nms-text-dim font-normal">— one per eNB hardware type</span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRefModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                  title="EARFCN / Frequency conversion reference">
                  <BookOpen className="w-3.5 h-3.5" />
                  EARFCN Ref
                </button>
                <button type="button" onClick={addBand}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border border-nms-accent/40 text-nms-accent hover:bg-nms-accent/10 transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  Add Band
                </button>
              </div>
            </div>
            {(cfgForm.frequencyBands ?? []).length === 0 && (
              <p className="text-xs text-nms-text-dim py-2">No bands configured. Click Add Band to define a frequency range for your eNB hardware.</p>
            )}
            <div className="space-y-2">
              {(cfgForm.frequencyBands ?? []).map((band: any, i: number) => (
                <BandRow key={band.id ?? i} band={band} onChange={(u) => updateBand(i, u)} onDelete={() => deleteBand(i)} />
              ))}
            </div>
          </div>

          <button type="button" onClick={saveConfig} disabled={saving} className="nms-btn-primary flex items-center gap-2">
            {saving ? <><RefreshCw className="w-4 h-4 animate-spin" />Saving…</> : 'Save Configuration'}
          </button>
        </div>
      )}

      {/* ── API Reference ── */}
      {tab === 'api' && (
        <div className="space-y-4">
          <div className="nms-card space-y-3">
            <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
              <Server className="w-4 h-4 text-nms-accent" />
              WinnForum SAS-CBSD Endpoints
            </h2>
            <p className="text-xs text-nms-text-dim">All endpoints accept and return JSON arrays per WINNF-TS-0016 section 9. HTTP POST, no authentication required from CBSDs.</p>
            <div className="border border-nms-border rounded-lg overflow-hidden">
              {ENDPOINTS.map((ep, i) => (
                <div key={ep.path} className={clsx('flex items-start gap-3 px-4 py-3 hover:bg-nms-surface-2 transition-colors', i < ENDPOINTS.length - 1 && 'border-b border-nms-border')}>
                  <span className="font-mono text-xs font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded px-1.5 py-0.5 shrink-0 mt-0.5">{ep.method}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-nms-accent break-all">{SAS_BASE}{ep.path}</p>
                    <p className="text-xs text-nms-text-dim mt-0.5">{ep.desc}</p>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(`${SAS_BASE}${ep.path}`); toast.success('Copied'); }}
                    className="text-xs text-nms-text-dim hover:text-nms-accent shrink-0">Copy</button>
                </div>
              ))}
            </div>
          </div>
          <div className="nms-card bg-amber-500/5 border-amber-500/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs text-nms-text-dim space-y-1">
                <p><span className="font-semibold text-nms-text">For Sercomm/FreedomFi radios:</span> Enable SAS in the Auto Config → Sercomm ACS module and set the SAS server URL to the endpoint shown on the Dashboard tab.</p>
                <p>Set <span className="font-mono text-nms-text">SAS Category = A</span>, <span className="font-mono text-nms-text">Protection Level = GAA</span>, and disable CPI for private CBRS use.</p>
                <p>The radio will register on boot, request a spectrum grant, and send heartbeats every {config?.heartbeatInterval ?? 240} seconds to maintain its grant.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Logs ── */}
      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-nms-text flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-nms-accent" />
              SAS Request Logs
            </h2>
            <div className="flex items-center gap-2">
              <select value={logLines} onChange={e => setLogLines(Number(e.target.value))} className="nms-input text-xs py-1 px-2 h-7 w-28">
                <option value={50}>Last 50</option>
                <option value={200}>Last 200</option>
                <option value={500}>Last 500</option>
                <option value={1000}>Last 1000</option>
              </select>
              <button onClick={() => loadLogs()} disabled={logsLoading}
                className="nms-btn border border-nms-border text-nms-text-dim hover:text-nms-text flex items-center gap-1.5 text-xs h-7 px-2">
                <RefreshCw className={clsx('w-3.5 h-3.5', logsLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
          <div className="nms-card p-0 overflow-hidden">
            {logsLoading && !logs && <div className="flex items-center justify-center h-32 text-nms-text-dim text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading logs…</div>}
            {!logsLoading && !logs && (
              <div className="flex flex-col items-center justify-center h-32 text-nms-text-dim border border-dashed border-nms-border rounded-lg">
                <ScrollText className="w-6 h-6 mb-1.5 opacity-30" />
                <p className="text-sm">No SAS log entries yet</p>
                <p className="text-xs mt-1">Logs appear when CBSDs connect and send requests</p>
              </div>
            )}
            {logs && (
              <pre ref={logRef} className="font-mono text-xs text-nms-text-dim leading-relaxed p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all bg-nms-bg rounded-lg">
                {logs}
              </pre>
            )}
          </div>
          <p className="text-xs text-nms-text-dim">Auto-refreshes every 5 seconds. Shows only SAS protocol messages.</p>
        </div>
      )}

    </div>
  );
}
