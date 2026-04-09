'use client';

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area,
} from "recharts";
import dynamic from 'next/dynamic';
const OrderTab = dynamic(() => import('@/components/OrderTab'), {
  loading: () => <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Загрузка...</div>,
  ssr: false,
})

const UpdateTab = dynamic(() => import('@/components/UpdateTab'), {
  loading: () => <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Загрузка...</div>,
  ssr: false,
})

// ═══════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════
interface PriceChange {
  date: string;
  pct: number;
  old_price: number | null;
  new_price: number | null;
  delta_ctr: number | null;
  delta_cr_cart: number | null;
  delta_cr: number | null;
  delta_cost: number | null;
  delta_cpm: number | null;
  delta_cpc: number | null;
}

interface RawSKU {
  sku: number;
  cat: string;
  pred: string;
  name: string;
  brand: string;
  mgr: string;
  is_new: boolean;
  appear_date: string | null;
  margin_pct: number | null;
  chmd: number | null;
  drr_plan: number | null;
  drr_fact: number | null;
  drr_adv: number | null;
  rev_plan: number | null;
  rev_fact: number | null;
  ctr: number | null;
  cr_cart: number | null;
  cr: number | null;
  cpc: number | null;
  cpm: number | null;
  stock_days: number | null;
  oos_days: number | null;
  stock_wb: number | null;
  stock_fbs: number | null;
  stock_kits: number | null;
  stock_total: number | null;
  days_to_supply: number | null;
  adv_share: number | null;
  costs: number | null;
  price: number | null;
  sales_per_day: number | null;
  oos_days_calc: number | null;
  supply_date: string | null;
  supply_qty: number | null;
  price_chg_avg: number | null;
  price_changes: PriceChange[];
  rev_d: (number | null)[];
  cost_d: (number | null)[];
  drr_d: (number | null)[];
  drr_adv_d: (number | null)[];
  ctr_d: (number | null)[];
  cr_cart_d: (number | null)[];
  cr_d: (number | null)[];
  cpm_d: (number | null)[];
  cpc_d: (number | null)[];
  chmd_d?: (number | null)[];  // дневной ЧМД (из route.ts)
  gmroi_calc: number | null;   // GMROI расчётный = ЧМД_чистый / ТЗ
}

type OosStatus = 'green' | 'yellow' | 'red';

interface ComputedSKU extends RawSKU {
  _oosst: OosStatus;
  _mrgst: OosStatus;
  _drrover: boolean;
  _rev_period: number;
  _cost_period: number;
  _chmd_period: number | null;
  _drr_period: number | null;
  _ctr_period: number | null;
  _cr_cart_period: number | null;
  _cr_period: number | null;
  _cpo: number | null;
  _orders_period: number;
  _sales_per_day: number | null;
  [key: string]: any;
}

interface DashboardData {
  DAYS: string[];
  RAW: RawSKU[];
  userRole?: string;
}

// ═══════════════════════════════════════
//  THEME & CONSTANTS
// ═══════════════════════════════════════
const C = {
  bg: "#0f1117", card: "#1a1f2e", border: "#2d3548", cardHover: "#1e2535",
  blue: "#3b82f6", green: "#22c55e", yellow: "#f59e0b", red: "#ef4444",
  purple: "#8b5cf6", pink: "#ec4899", orange: "#f97316", teal: "#10b981",
  text: "#f1f5f9", textSec: "#94a3b8", textMute: "#64748b", textDim: "#475569",
  grid: "#1e2535",
};
const PIE_COLORS = [C.blue, C.purple, C.pink, C.yellow, C.teal, C.orange];
const PAGE_SIZE = 100;

// ═══════════════════════════════════════
//  FORMATTERS
// ═══════════════════════════════════════
const fR = (v: number | null | undefined): string =>
  v == null ? "—" : Math.round(v).toLocaleString("ru-RU") + " ₽";
const fM = (v: number | null | undefined): string => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + " M ₽";
  return (v / 1e3).toFixed(1) + " K ₽";
};
// Axis label formatter — compact, no ₽ symbol
const fAxis = (v: number | null | undefined): string => {
  if (v == null) return "";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return String(Math.round(v));
};
const fP = (v: number | null | undefined): string =>
  v == null ? "—" : (v * 100).toFixed(2) + "%";
const fPv = (v: number | null | undefined): string =>
  v == null ? "—" : Number(v).toFixed(1) + "%";
const sum = (a: (number | null | undefined)[]): number =>
  (a || []).reduce((s: number, x) => s + (x || 0), 0);
const avg = (a: (number | null | undefined)[]): number | null => {
  const nn = (a || []).filter((x): x is number => x != null && !isNaN(x as number));
  return nn.length ? nn.reduce((s, x) => s + x, 0) / nn.length : null;
};

// ═══════════════════════════════════════
//  STATUS HELPERS
// ═══════════════════════════════════════
const oosStatus = (r: RawSKU): OosStatus => {
  if (r.oos_days == null) return "green";
  if (r.oos_days <= 0) return "red";
  if (r.oos_days < 14) return "yellow";
  return "green";
};
const mrgStatus = (r: RawSKU): OosStatus => {
  if (r.margin_pct == null) return "green";
  if (r.margin_pct < 15) return "red";
  if (r.margin_pct < 20) return "yellow";
  return "green";
};
const statusColor: Record<OosStatus, string> = { green: C.green, yellow: C.yellow, red: C.red };
const oosLabel: Record<OosStatus, string> = { green: "Норма", yellow: "Внимание", red: "Критично" };
const mrgLabel: Record<OosStatus, string> = { green: "Высокая", yellow: "Средняя", red: "Низкая" };

// ═══════════════════════════════════════
//  RECOMPUTE — period-aware fields
// ═══════════════════════════════════════
function recompute(r: RawSKU, drS: number, drE: number): ComputedSKU {
  const slice = (arr: (number | null | undefined)[]) => (arr || []).slice(drS, drE + 1);
  const revP = sum(slice(r.rev_d));
  const costP = sum(slice(r.cost_d));

  // ДРР = затраты / выручка (НЕ среднее из drr_d)
  const drrP = revP > 0 ? costP / revP : null;

  const ctrP = avg(slice(r.ctr_d));
  const crCartP = avg(slice(r.cr_cart_d));
  const crP = avg(slice(r.cr_d));

  // ЧМД = сумма дневных ЧМД за выбранный период (если есть chmd_d)
  // Fallback: пропорция от выручки (старая логика)
  let chmdP: number | null;
  if (r.chmd_d && r.chmd_d.length > 0) {
    chmdP = sum(slice(r.chmd_d));
  } else {
    const totalRev = sum(r.rev_d);
    chmdP = totalRev > 0 && r.chmd != null ? r.chmd * (revP / totalRev) : r.chmd;
  }

  const drrOver = drrP != null && r.margin_pct != null && drrP > r.margin_pct / 100;

  // Продажи за период (шт) и среднедневные
  const periodDays = drE - drS + 1;
  const ordersPeriod = r.price && r.price > 0 ? revP / r.price : 0;
  const salesPerDayPeriod = periodDays > 0 ? ordersPeriod / periodDays : null;

  return {
    ...r,
    _oosst: oosStatus(r), _mrgst: mrgStatus(r), _drrover: drrOver,
    _rev_period: revP, _cost_period: costP, _chmd_period: chmdP,
    _drr_period: drrP, _ctr_period: ctrP, _cr_cart_period: crCartP,
    _cr_period: crP,
    _cpo: r.price && r.price > 0 && revP > 0 ? costP / (revP / r.price) : null,
    _orders_period: Math.round(ordersPeriod),
    _sales_per_day: salesPerDayPeriod,
  };
}

// ═══════════════════════════════════════
//  XLSX EXPORT
// ═══════════════════════════════════════
async function exportXLSX(data: ComputedSKU[], DAYS: string[], drS: number, drE: number) {
  // Dynamically load SheetJS
  const XLSX = await import('xlsx');
  const headers = ['SKU', 'Название', 'Менеджер', 'Категория', 'Новинка', 'Выручка период',
    'ЧМД период', 'Маржа %', 'ДРР факт %', 'ДРР план %', 'CTR %', 'CR корзина %',
    'CR заказ %', 'OOS дней', 'Цена', 'Расходы рекл.', 'CPO'];
  const rows = data.map(r => {
    const orders = (r.price && r.price > 0 && r._rev_period) ? r._rev_period / r.price : 0;
    const cpo = orders > 0 ? (r._cost_period || 0) / orders : null;
    return [
      r.sku, r.name || '', r.mgr || '', r.cat || '', r.is_new ? 'Да' : 'Нет',
      Math.round(r._rev_period || 0), Math.round(r._chmd_period || 0),
      r.margin_pct != null ? r.margin_pct / 100 : null,
      r._drr_period, r.drr_plan, r._ctr_period, r._cr_cart_period, r._cr_period,
      r.oos_days, r.price != null ? Math.round(r.price) : null,
      Math.round(r._cost_period || 0), cpo != null ? Math.round(cpo) : null,
    ];
  });
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 8 }, { wch: 14 },
    { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }];
  // % format for certain columns
  const pctCols = [7, 8, 9, 10, 11, 12];
  for (let ri = 1; ri <= rows.length; ri++) {
    for (const ci of pctCols) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr] && ws[addr].v != null) { ws[addr].t = 'n'; ws[addr].z = '0.00%'; }
    }
    for (const ci of [5, 6, 14, 15, 16]) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr] && ws[addr].v != null) { ws[addr].t = 'n'; ws[addr].z = '#,##0'; }
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wb_export_${DAYS[drS]}-${DAYS[drE]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportPriceXLSX(data: any[], days: string[], drS: number, drE: number, skuMap?: Map<number, any>) {
  const XLSX = await import('xlsx');
  const headers = ['SKU', 'Категория', 'Предмет', 'Название', 'Бренд', 'Менеджер', 'Дата',
    'Было ₽', 'Стало ₽', 'Δ%',
    'Расх. до', 'Расх. после', 'Δ CTR', 'Δ CR корзина', 'Δ CR заказ', 'CPO', 'Δ CPM', 'Δ CPC',
    'Маржа %', 'ДРР факт', 'ДРР план', 'Выручка (период)', 'ЧМД (период)', 'CTR %', 'CR корзина %', 'CR заказ %',
    'Остаток WB', 'Остаток FBS', 'Дней запаса', 'Цена текущая'];
  const rows = data.map((ch: any) => {
    const r = skuMap?.get(ch.sku) ?? {};
    return [
      ch.sku, r.cat ?? '', r.pred ?? '', ch.name || '', r.brand ?? '', ch.mgr || '', ch.date,
      ch.old_price ?? '', ch.new_price ? Math.round(ch.new_price) : '',
      ch.pct != null ? ch.pct : '',
      ch.cost_before != null ? Math.round(ch.cost_before) : '',
      ch.cost_after != null ? Math.round(ch.cost_after) : '',
      ch.delta_ctr, ch.delta_cr_cart, ch.delta_cr,
      ch.cpo != null ? Math.round(ch.cpo) : '',
      ch.delta_cpm, ch.delta_cpc,
      r.margin_pct != null ? +r.margin_pct.toFixed(2) : '',
      r.drr_fact != null ? +r.drr_fact.toFixed(4) : '',
      r.drr_plan != null ? +r.drr_plan.toFixed(4) : '',
      r._rev_period != null ? Math.round(r._rev_period) : '',
      r._chmd_period != null ? Math.round(r._chmd_period) : '',
      r.ctr != null ? +(r.ctr * 100).toFixed(2) : '',
      r.cr_cart != null ? +(r.cr_cart * 100).toFixed(2) : '',
      r.cr != null ? +(r.cr * 100).toFixed(2) : '',
      r.stock_wb ?? '', r.stock_fbs ?? '', r.stock_days ?? '', r.price ?? '',
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  for (let ri = 1; ri <= rows.length; ri++) {
    for (const ci of [12, 13, 14, 15, 16]) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr] && ws[addr].v != null && typeof ws[addr].v === 'number') { ws[addr].t = 'n'; ws[addr].z = '0.00%'; }
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Цены');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `wb_prices_${days[drS]}-${days[drE]}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function exportAnalyticsXLSX(categories: any[], days: string[], drS: number, drE: number, expanded: Set<string>) {
  const XLSX = await import('xlsx');
  const headers = ['Уровень', 'SKU', 'Название', 'Выручка', 'Δ выр.', 'ЧМД', 'Δ ЧМД',
    'Маржа %', 'Δ маржа', 'ДРР %', 'Δ ДРР', 'Расходы', 'Δ расх.', 'Кол-во SKU'];
  const rows: any[][] = [];

  const addRow = (row: any, level: string) => {
    const m = row.rev > 0 ? row.marginWeighted / row.rev : null;
    const mPrev = row.revPrev > 0 ? row.marginWeightedPrev / row.revPrev : null;
    rows.push([
      level, row.level === 'sku' ? (row as any).sku_id ?? '' : '', row.name, Math.round(row.rev),
      row.revDelta, Math.round(row.chmd), row.chmdDelta,
      m != null ? m / 100 : null,
      m != null && mPrev != null ? (m - mPrev) / 100 : null,
      row.drr, row.drrPrev != null && row.drr != null ? row.drr - row.drrPrev : null,
      Math.round(row.cost), row.costDelta, row.skuCount,
    ]);
  };

  for (const cat of categories) {
    addRow(cat, 'Категория');
    if (cat.children) {
      for (const pred of cat.children) {
        addRow(pred, '  Предмет');
        if (pred.children) {
          for (const sku of pred.children) {
            addRow(sku, '    SKU');
          }
        }
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 35 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 6 }];
  for (let ri = 1; ri <= rows.length; ri++) {
    for (const ci of [3, 5, 6, 7, 8, 9, 11]) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr] && ws[addr].v != null && typeof ws[addr].v === 'number') { ws[addr].t = 'n'; ws[addr].z = '0.00%'; }
    }
    for (const ci of [2, 4, 10]) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr] && ws[addr].v != null) { ws[addr].t = 'n'; ws[addr].z = '#,##0'; }
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Аналитика');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `wb_analytics_${days[drS]}-${days[drE]}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════
//  PPTX EXPORT — Dashboard to PowerPoint
// ═══════════════════════════════════════

// Helper: convert SVG element to PNG base64
async function svgToPng(svgEl: SVGSVGElement, width: number, height: number): Promise<string> {
  return new Promise((resolve) => {
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2; // 2x for retina quality
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0f1219';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

interface PPTXData {
  period: string;
  skuCount: number;
  kpi: { label: string; value: string; delta?: string; good?: boolean }[];
  comparison: { label: string; cur: string; prev: string; delta: string; good: boolean }[] | null;
  alerts: { title: string; count: number; desc: string; topSkus: { sku: number; name: string; value: string }[] }[];
  categories: { name: string; rev: string; delta: string; cnt: number }[];
  dynamics: { name: string; revChange: string; delta: string; rev: string }[];
  managers: { name: string; sku: number; newCount: number; rev: string; chmd: string; margin: string; drr: string; oosR: number; oosY: number; drrOver: number }[];
  dailyData: { date: string; rev: string; cost: string; drr: string }[];
}

async function exportPPTX(data: PPTXData) {
  const pptxgenjs = await import('pptxgenjs');
  const pptx = new pptxgenjs.default();
  pptx.layout = 'LAYOUT_WIDE';

  const BG = '1A2035';
  const CARD = '232B42';
  const TEXT = 'E2E8F0';
  const MUTE = '8892A8';
  const BLUE = '3B82F6';
  const GREEN = '22C55E';
  const RED = 'EF4444';
  const TEAL = '14B8A6';
  const YELLOW = 'EAB308';
  const PURPLE = 'A855F7';
  const bdr = { type: 'solid' as const, pt: 0.5, color: '2E3650' };

  // ── Slide 1: Title ──
  const s1 = pptx.addSlide();
  s1.background = { color: BG };
  s1.addText('WB Новинки', { x: 0.8, y: 1.8, w: 11, h: 1, fontSize: 40, fontFace: 'Arial', color: TEXT, bold: true });
  s1.addText('Аналитический отчёт по рекламе', { x: 0.8, y: 2.8, w: 11, h: 0.6, fontSize: 18, color: MUTE });
  s1.addText(`Период: ${data.period}`, { x: 0.8, y: 3.8, w: 6, h: 0.5, fontSize: 18, color: BLUE, bold: true });
  s1.addText(`${data.skuCount} SKU  ·  ${new Date().toLocaleDateString('ru-RU')}`, { x: 0.8, y: 4.4, w: 6, h: 0.5, fontSize: 14, color: MUTE });

  // ── Slide 2: KPI with deltas ──
  const s2 = pptx.addSlide();
  s2.background = { color: BG };
  s2.addText('Ключевые показатели', { x: 0.5, y: 0.3, w: 12, h: 0.7, fontSize: 24, color: TEXT, bold: true });
  const kpiPerRow = 3;
  data.kpi.forEach((k, i) => {
    const col = i % kpiPerRow;
    const row = Math.floor(i / kpiPerRow);
    const x = 0.5 + col * 4.1;
    const y = 1.3 + row * 2.2;
    s2.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.8, h: 1.8, fill: { color: CARD }, rectRadius: 0.2 });
    s2.addText(k.label, { x: x + 0.2, y: y + 0.2, w: 3.4, h: 0.35, fontSize: 11, color: MUTE });
    s2.addText(k.value, { x: x + 0.2, y: y + 0.55, w: 3.4, h: 0.7, fontSize: 26, color: TEXT, bold: true });
    if (k.delta) {
      s2.addText(k.delta, { x: x + 0.2, y: y + 1.3, w: 3.4, h: 0.35, fontSize: 12, color: k.good ? GREEN : RED, bold: true });
    }
  });

  // ── Slide 3: Comparison table (larger) ──
  if (data.comparison && data.comparison.length > 0) {
    const s3 = pptx.addSlide();
    s3.background = { color: BG };
    s3.addText('Сравнение с предыдущим периодом', { x: 0.5, y: 0.3, w: 12, h: 0.7, fontSize: 24, color: TEXT, bold: true });
    const cmpRows: any[][] = [
      [{ text: 'Показатель', options: { bold: true, color: MUTE, fontSize: 12 } },
       { text: 'Текущий период', options: { bold: true, color: BLUE, fontSize: 12 } },
       { text: 'Прошлый период', options: { bold: true, color: MUTE, fontSize: 12 } },
       { text: 'Изменение', options: { bold: true, color: MUTE, fontSize: 12 } }],
    ];
    data.comparison.forEach(c => {
      cmpRows.push([
        { text: c.label, options: { color: TEXT, fontSize: 13 } },
        { text: c.cur, options: { color: TEXT, fontSize: 13, bold: true } },
        { text: c.prev, options: { color: MUTE, fontSize: 13 } },
        { text: c.delta, options: { color: c.good ? GREEN : RED, fontSize: 13, bold: true } },
      ]);
    });
    s3.addTable(cmpRows, { x: 1, y: 1.5, w: 11, rowH: 0.55, colW: [3.5, 2.5, 2.5, 2.5], border: bdr, fill: { color: CARD } });
  }

  // ── Slide 4: Charts (SVG screenshots) ──
  const chartSvgs = document.querySelectorAll('.recharts-surface');
  if (chartSvgs.length >= 2) {
    const s4 = pptx.addSlide();
    s4.background = { color: BG };
    s4.addText('Графики: Выручка / Расходы / ДРР', { x: 0.5, y: 0.2, w: 12, h: 0.6, fontSize: 22, color: TEXT, bold: true });
    for (let j = 0; j < Math.min(2, chartSvgs.length); j++) {
      const svg = chartSvgs[j] as SVGSVGElement;
      const rect = svg.getBoundingClientRect();
      try {
        const png = await svgToPng(svg, rect.width, rect.height);
        if (png) s4.addImage({ data: png, x: 0.3, y: 0.9 + j * 3.3, w: 12.5, h: 3.1 });
      } catch {}
    }
  }

  // ── Slide 5: Daily data table ──
  if (data.dailyData.length > 0) {
    const s5 = pptx.addSlide();
    s5.background = { color: BG };
    s5.addText('Данные по дням', { x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 22, color: TEXT, bold: true });
    const dayRows: any[][] = [
      [{ text: 'Дата', options: { bold: true, color: MUTE, fontSize: 10 } },
       { text: 'Выручка', options: { bold: true, color: BLUE, fontSize: 10 } },
       { text: 'Расходы', options: { bold: true, color: RED, fontSize: 10 } },
       { text: 'ДРР', options: { bold: true, color: YELLOW, fontSize: 10 } }],
    ];
    data.dailyData.forEach(d => {
      dayRows.push([
        { text: d.date, options: { color: MUTE, fontSize: 10 } },
        { text: d.rev, options: { color: TEXT, fontSize: 10 } },
        { text: d.cost, options: { color: TEXT, fontSize: 10 } },
        { text: d.drr, options: { color: TEXT, fontSize: 10 } },
      ]);
    });
    s5.addTable(dayRows, { x: 0.5, y: 1.1, w: 12, colW: [2, 4, 3, 3], border: bdr, fill: { color: CARD }, rowH: 0.35 });
  }

  // ── Slides 6+: Alerts with top SKUs ──
  for (let ai = 0; ai < data.alerts.length; ai++) {
    const alert = data.alerts[ai];
    if (alert.count === 0) continue;
    const sa = pptx.addSlide();
    sa.background = { color: BG };
    sa.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 0.3, w: 12.3, h: 0.8, fill: { color: CARD }, rectRadius: 0.15 });
    sa.addText(`${alert.title}  —  ${alert.count} товаров`, { x: 0.7, y: 0.35, w: 10, h: 0.35, fontSize: 18, color: TEXT, bold: true });
    sa.addText(alert.desc, { x: 0.7, y: 0.72, w: 10, h: 0.3, fontSize: 11, color: MUTE });

    if (alert.topSkus.length > 0) {
      const skuRows: any[][] = [
        [{ text: 'SKU', options: { bold: true, color: MUTE, fontSize: 10 } },
         { text: 'Название', options: { bold: true, color: MUTE, fontSize: 10 } },
         { text: 'Значение', options: { bold: true, color: MUTE, fontSize: 10 } }],
      ];
      alert.topSkus.forEach(s => {
        skuRows.push([
          { text: String(s.sku), options: { color: MUTE, fontSize: 11 } },
          { text: s.name.slice(0, 50), options: { color: TEXT, fontSize: 11 } },
          { text: s.value, options: { color: RED, fontSize: 11, bold: true } },
        ]);
      });
      sa.addText('Топ-5 товаров, требующих внимания:', { x: 0.7, y: 1.4, w: 10, h: 0.4, fontSize: 13, color: BLUE, bold: true });
      sa.addTable(skuRows, { x: 0.5, y: 1.9, w: 12, colW: [2, 7, 3], border: bdr, fill: { color: CARD }, rowH: 0.45 });
    }
  }

  // ── Slide: Top Categories ──
  const sCat = pptx.addSlide();
  sCat.background = { color: BG };
  sCat.addText('Топ категории по выручке', { x: 0.5, y: 0.3, w: 12, h: 0.7, fontSize: 24, color: TEXT, bold: true });
  const catRows: any[][] = [
    [{ text: '#', options: { bold: true, color: MUTE, fontSize: 11 } },
     { text: 'Категория', options: { bold: true, color: MUTE, fontSize: 11 } },
     { text: 'Выручка', options: { bold: true, color: BLUE, fontSize: 11 } },
     { text: 'Δ', options: { bold: true, color: MUTE, fontSize: 11 } },
     { text: 'SKU', options: { bold: true, color: MUTE, fontSize: 11 } }],
  ];
  data.categories.slice(0, 15).forEach((c, i) => {
    const dn = parseFloat(c.delta);
    catRows.push([
      { text: String(i + 1), options: { color: BLUE, fontSize: 12, bold: true } },
      { text: c.name, options: { color: TEXT, fontSize: 12 } },
      { text: c.rev, options: { color: BLUE, fontSize: 12, bold: true } },
      { text: c.delta, options: { color: dn > 0 ? GREEN : dn < 0 ? RED : MUTE, fontSize: 12, bold: true } },
      { text: String(c.cnt), options: { color: MUTE, fontSize: 12 } },
    ]);
  });
  sCat.addTable(catRows, { x: 1.5, y: 1.3, w: 10, colW: [0.6, 5, 1.8, 1.3, 1], border: bdr, fill: { color: CARD }, rowH: 0.38 });

  // ── Slide: Dynamics ──
  if (data.dynamics.length > 0) {
    const sDyn = pptx.addSlide();
    sDyn.background = { color: BG };
    sDyn.addText('Динамика категорий по выручке', { x: 0.5, y: 0.3, w: 12, h: 0.7, fontSize: 24, color: TEXT, bold: true });
    const dynRows: any[][] = [
      [{ text: '', options: { color: MUTE, fontSize: 10 } },
       { text: 'Категория', options: { bold: true, color: MUTE, fontSize: 11 } },
       { text: 'Изменение', options: { bold: true, color: MUTE, fontSize: 11 } },
       { text: 'Δ %', options: { bold: true, color: MUTE, fontSize: 11 } },
       { text: 'Выручка', options: { bold: true, color: MUTE, fontSize: 11 } }],
    ];
    data.dynamics.slice(0, 15).forEach(d => {
      const up = !d.revChange.startsWith('-');
      dynRows.push([
        { text: up ? '▲' : '▼', options: { color: up ? GREEN : RED, fontSize: 14, bold: true } },
        { text: d.name, options: { color: TEXT, fontSize: 12 } },
        { text: d.revChange, options: { color: up ? GREEN : RED, fontSize: 12, bold: true } },
        { text: d.delta, options: { color: up ? GREEN : RED, fontSize: 12 } },
        { text: d.rev, options: { color: BLUE, fontSize: 12 } },
      ]);
    });
    sDyn.addTable(dynRows, { x: 1, y: 1.3, w: 11, colW: [0.5, 4.5, 2, 1.5, 2.5], border: bdr, fill: { color: CARD }, rowH: 0.38 });
  }

  // ── Slide: Managers (full table) ──
  const sMgr = pptx.addSlide();
  sMgr.background = { color: BG };
  sMgr.addText('Сводка по менеджерам', { x: 0.5, y: 0.3, w: 12, h: 0.7, fontSize: 24, color: TEXT, bold: true });
  const mgrRows: any[][] = [
    ['Менеджер', 'SKU', '★', 'Выручка', 'ЧМД', 'Маржа', 'ДРР', 'OOS крит.', 'OOS вним.', 'ДРР>М'].map(h =>
      ({ text: h, options: { bold: true, color: MUTE, fontSize: 10 } })
    ),
  ];
  data.managers.forEach(m => {
    mgrRows.push([
      { text: m.name, options: { color: TEXT, fontSize: 11, bold: true } },
      { text: String(m.sku), options: { color: MUTE, fontSize: 11 } },
      { text: String(m.newCount), options: { color: PURPLE, fontSize: 11 } },
      { text: m.rev, options: { color: BLUE, fontSize: 11, bold: true } },
      { text: m.chmd, options: { color: TEAL, fontSize: 11 } },
      { text: m.margin, options: { color: GREEN, fontSize: 11 } },
      { text: m.drr, options: { color: YELLOW, fontSize: 11 } },
      { text: String(m.oosR), options: { color: RED, fontSize: 11, bold: true } },
      { text: String(m.oosY), options: { color: YELLOW, fontSize: 11, bold: true } },
      { text: String(m.drrOver), options: { color: RED, fontSize: 11, bold: true } },
    ]);
  });
  sMgr.addTable(mgrRows, { x: 0.3, y: 1.2, w: 12.7, colW: [2.2, 0.7, 0.7, 2, 1.8, 1.2, 1.2, 1, 1, 0.9], border: bdr, fill: { color: CARD }, rowH: 0.5 });

  pptx.writeFile({ fileName: `wb_report_${data.period.replace(/\s/g, '')}.pptx` });
}

// ═══════════════════════════════════════
//  TOOLTIP
// ═══════════════════════════════════════
const ChartTooltip = ({ active, payload, label, formatter }: any) => {
  if (!active || !payload?.length) return null;
  // Map dark chart colors to light readable versions for tooltip text
  const lightColor: Record<string, string> = {
    [C.blue]: "#93c5fd",       // blue → light blue
    [C.blue + "40"]: "#93c5fd", // blue transparent → light blue
    [C.red]: "#fca5a5",        // red → light red
    [C.red + "aa"]: "#fca5a5", // red transparent → light red
    [C.green]: "#86efac",      // green → light green
    [C.green + "30"]: "#86efac", // green transparent → light green
    [C.yellow]: "#fde68a",     // yellow → light yellow
    [C.purple]: "#c4b5fd",     // purple → light purple
    [C.teal]: "#6ee7b7",       // teal → light teal
    [C.orange]: "#fdba74",     // orange → light orange
  };
  return (
    <div style={{ background: "#0a0d12", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,.8)", minWidth: 120 }}>
      <div style={{ color: "#e2e8f0", marginBottom: 5, fontWeight: 700 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: lightColor[p.color] || lightColor[p.stroke] || "#e2e8f0", fontWeight: 600, marginBottom: 2 }}>
          {p.name}: {formatter ? formatter(p.value, p.name) : p.value}
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════
//  UI ATOMS
// ═══════════════════════════════════════
const Dot = ({ color }: { color: string }) => (
  <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />
);

const Badge = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span style={{ background: color, borderRadius: 5, padding: "1px 7px", fontSize: 11, color: "#fff", fontWeight: 700 }}>{children}</span>
);

const TagNew = () => (
  <span style={{ border: `1px solid ${C.purple}`, color: C.purple, background: C.purple + "10", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>⭐</span>
);

const KPICard = ({ icon, label, value, color, sub, clickable, onClick }: {
  icon: string; label: string; value: string | number; color?: string; sub?: string;
  clickable?: boolean; onClick?: () => void;
}) => (
  <div onClick={onClick} style={{
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 11,
    padding: "13px 15px", position: "relative", overflow: "hidden",
    cursor: clickable ? "pointer" : "default", transition: ".15s",
  }}>
    <div style={{ position: "absolute", top: -2, right: 2, fontSize: 52, opacity: 0.07, pointerEvents: "none" }}>{icon}</div>
    <div style={{ color: C.textMute, fontSize: 11, marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.5, color: color || C.text }}>{value}</div>
    {sub && <div style={{ color: C.textDim, fontSize: 11, marginTop: 3 }}>{sub}</div>}
    {clickable && <div style={{ position: "absolute", bottom: 8, right: 10, color: C.blue + "40", fontSize: 14 }}>↗</div>}
  </div>
);

const Section = ({ title, icon, children, defaultOpen = true }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div onClick={() => setOpen(!open)} style={{
        fontSize: 12, fontWeight: 700, color: C.textDim, textTransform: "uppercase",
        letterSpacing: 0.7, padding: "4px 0 10px", display: "flex", alignItems: "center",
        gap: 8, cursor: "pointer", userSelect: "none",
      }}>
        {icon} {title}
        <span style={{ transition: "transform .2s", fontSize: 10, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>▼</span>
        <span style={{ flex: 1, height: 1, background: C.border }} />
      </div>
      {open && children}
    </div>
  );
};

interface FilterOption { value: string; label: string; }

const FilterSelect = ({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: FilterOption[];
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, paddingLeft: 2 }}>{label}</div>
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 7,
      padding: "6px 10px", color: C.text, fontSize: 12, outline: "none",
    }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const AlertCard = ({ type, icon, title, count, desc, onClick }: {
  type: string; icon: string; title: string; count: number; desc: string; onClick?: () => void;
}) => {
  const colors: Record<string, string> = { danger: C.red, warning: C.yellow, info: C.blue, success: C.green };
  return (
    <div onClick={count > 0 ? onClick : undefined} style={{
      background: "#111827", borderRadius: 10, padding: "12px 14px",
      borderLeft: `3px solid ${colors[type]}`, cursor: count > 0 ? "pointer" : "default", transition: ".15s",
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{icon} {title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2, color: colors[type] }}>{count}</div>
      <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.4 }}>{desc}</div>
      {count > 0 && <span style={{ color: C.blue + "80", fontSize: 10, marginTop: 5, display: "block" }}>↗ Показать товары</span>}
    </div>
  );
};

const CmpCard = ({ label, cur, prev, fmt, invert }: {
  label: string; cur: number | null; prev: number | null; fmt: (v: number | null) => string; invert?: boolean;
}) => {
  const d = prev != null && prev !== 0 && cur != null ? (cur - prev) / Math.abs(prev) : null;
  const up = d != null && d > 0;
  const good = invert ? !up : up;
  return (
    <div style={{ background: "#111827", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 10, color: C.textMute, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(cur)}</div>
      {d != null ? (
        <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: good ? C.green : C.red }}>
          {up ? "▲ +" : "▼ "}{(Math.abs(d) * 100).toFixed(1)}%
        </div>
      ) : <div style={{ fontSize: 11, color: C.textMute, marginTop: 2 }}>—</div>}
    </div>
  );
};

const CatRankItem = ({ pos, name, value, maxVal, color, sub, valueFmt }: {
  pos: string | number; name: string; value: number; maxVal: number; color?: string; sub?: string; valueFmt?: (v: number) => string;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#111827", borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
    <div style={{ fontSize: 16, fontWeight: 800, color: color || C.blue, width: 24, textAlign: "center", flexShrink: 0 }}>{pos}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      <div style={{ height: 4, background: C.cardHover, borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 3, background: color || C.blue, width: `${Math.min(100, Math.abs(value / (maxVal || 1)) * 100).toFixed(0)}%`, transition: "width .4s" }} />
      </div>
    </div>
    <div style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: color || C.blue, flexShrink: 0 }}>
      {valueFmt ? valueFmt(value) : fM(value)}
      {sub && <div style={{ color: C.textMute, fontSize: 10 }}>{sub}</div>}
    </div>
  </div>
);

// ═══════════════════════════════════════
//  SKU MODAL
// ═══════════════════════════════════════
function SKUModal({ sku, data, DAYS, drS, drE, onClose }: {
  sku: number; data: ComputedSKU; DAYS: string[]; drS: number; drE: number; onClose: () => void;
}) {
  const r = data;
  const days = DAYS.slice(drS, drE + 1);
  const revChartData = days.map((d, i) => ({ date: d, rev: r.rev_d?.[drS + i] || 0, cost: r.cost_d?.[drS + i] || 0 }));
  const convChartData = days.map((d, i) => ({ date: d, ctr: r.ctr_d?.[drS + i], cr_cart: r.cr_cart_d?.[drS + i], cr: r.cr_d?.[drS + i] }));
  const changes = r.price_changes || [];

  const dbFn = (v: number | null) => {
    if (v == null) return <span style={{ color: C.textDim }}>—</span>;
    const up = v > 0;
    return <span style={{ color: up ? C.green : C.red, fontWeight: 700 }}>{up ? "▲ +" : "▼ "}{(Math.abs(v) * 100).toFixed(1)}%</span>;
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 500,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto",
    }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, width: "100%", maxWidth: 900, margin: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <Badge color={statusColor[r._oosst]}>OOS: {oosLabel[r._oosst]}</Badge>
              <Badge color={statusColor[r._mrgst]}>Маржа: {mrgLabel[r._mrgst]}</Badge>
              {r.is_new && <TagNew />}
            </div>
            <div style={{ fontSize: 13, color: C.textMute }}>SKU {r.sku}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: C.textMute, marginTop: 3 }}>
              {r.cat} · {r.pred} · {r.brand} · {r.mgr}{r.appear_date ? ` · с ${r.appear_date}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMute, cursor: "pointer", fontSize: 20, padding: 3 }}>✕</button>
        </div>

        {/* KPI 4-col */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 9 }}>
          {[
            { l: "Цена", v: fR(r.price) },
            { l: "Маржа", v: fPv(r.margin_pct), c: (r.margin_pct ?? 0) < 15 ? C.red : (r.margin_pct ?? 0) < 20 ? C.yellow : C.green },
            { l: "ЧМД (период)", v: fR(r._chmd_period), c: C.teal },
            { l: "Расходы рекл.", v: fR(r._cost_period) },
          ].map((s, i) => (
            <div key={i} style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10, marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: s.c || C.text }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Finance 3-col */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 9 }}>
          {[
            { l: "Выручка (период)", v: fR(r._rev_period), sub: `всего: ${fR(r.rev_fact)}` },
            { l: "ДРР факт (период)", v: fP(r._drr_period), sub: `маржа: ${fPv(r.margin_pct)}`, sc: r._drrover ? C.red : C.green },
            { l: "ДРР рекл.", v: fP(r.drr_adv), sub: `доля рекл. заказов: ${fP(r.adv_share)}` },
          ].map((s, i) => (
            <div key={i} style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10, marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: s.sc || C.textMute, marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Adv metrics 5-col */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 9 }}>
          {[
            { l: "CTR", v: fP(r._ctr_period), c: C.blue },
            { l: "CR корзина", v: fP(r._cr_cart_period), c: C.yellow },
            { l: "CR заказ", v: fP(r._cr_period), c: C.green },
            { l: "CPC · CPM", v: `${r.cpc != null ? r.cpc.toFixed(1) + "₽" : "—"} · ${r.cpm != null ? Math.round(r.cpm) + "₽" : "—"}` },
            { l: "CPO", v: r._cpo != null ? Math.round(r._cpo).toLocaleString("ru-RU") + " ₽" : "—", c: r._cpo != null ? (r._cpo > 500 ? C.red : r._cpo > 200 ? C.yellow : C.green) : C.textMute },
          ].map((s, i) => (
            <div key={i} style={{ background: "#111827", borderRadius: 8, padding: "9px 11px", textAlign: "center" }}>
              <div style={{ color: C.textMute, fontSize: 10, marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: s.c || C.text }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Supply */}
        {(r.supply_date || r.supply_qty) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 9 }}>
            <div style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10 }}>Дата поставки (план)</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>{r.supply_date || "—"}</div>
            </div>
            <div style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10 }}>Объём, шт.</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{r.supply_qty ? Math.round(r.supply_qty) + " шт." : "—"}</div>
            </div>
            <div style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10 }}>Дней до прихода</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{r.days_to_supply != null ? r.days_to_supply + " д." : "—"}</div>
            </div>
          </div>
        )}

        {/* Stock & Sales */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 6 }}>
          {[
            { l: "Общий остаток", v: r.stock_total != null ? Math.round(r.stock_total) + " шт." : "—", c: C.text },
            { l: "Остаток ФБО", v: r.stock_wb != null ? Math.round(r.stock_wb) + " шт." : "—" },
            { l: "Остаток ФБС", v: r.stock_fbs != null ? Math.round(r.stock_fbs) + " шт." : "—" },
            { l: "Комплекты", v: r.stock_kits != null ? Math.round(r.stock_kits) + " шт." : "—" },
          ].map((s, i) => (
            <div key={i} style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10, marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: s.c || C.text }}>{s.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
          {[
            { l: "Запас до OOS (табл.)", v: r.oos_days != null ? r.oos_days + " д." : "—", c: r.oos_days != null && r.oos_days <= 0 ? C.red : r.oos_days != null && r.oos_days < 14 ? C.yellow : C.green },
            { l: "Запас до OOS (расч.)", v: r.oos_days_calc != null ? r.oos_days_calc + " д." : "—", c: r.oos_days_calc != null && r.oos_days_calc <= 0 ? C.red : r.oos_days_calc != null && r.oos_days_calc < 14 ? C.yellow : C.green },
            { l: "Остаток дней", v: r.stock_days != null ? r.stock_days + " д." : "—" },
            { l: "Продажи ~шт/день", v: r._sales_per_day != null ? r._sales_per_day.toFixed(1) + " шт." : "—", c: C.blue },
          ].map((s, i) => (
            <div key={i} style={{ background: "#111827", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: C.textMute, fontSize: 10, marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: s.c || C.text }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Price changes */}
        {changes.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.textSec, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7 }}>Изменения цены</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}><tr>
                  {["Дата", "Было", "Стало", "Δ%", "Δ CTR", "Δ CR корзина", "Δ CR заказ"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "5px 8px", color: C.textMute, fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {changes.map((ch, i) => {
                    const up = ch.pct > 0;
                    return (
                      <tr key={i} style={{ borderLeft: `2px solid ${up ? C.green : C.red}`, borderBottom: `1px solid ${C.cardHover}` }}>
                        <td style={{ padding: "5px 8px", color: C.textSec }}>{ch.date}</td>
                        <td style={{ padding: "5px 8px", color: C.textMute }}>{ch.old_price ? ch.old_price.toLocaleString("ru-RU") + " ₽" : "—"}</td>
                        <td style={{ padding: "5px 8px", fontWeight: 700 }}>{ch.new_price ? Math.round(ch.new_price).toLocaleString("ru-RU") + " ₽" : "—"}</td>
                        <td style={{ padding: "5px 8px", color: up ? C.green : C.red, fontWeight: 700 }}>{up ? "▲ +" : "▼ "}{(ch.pct * 100).toFixed(1)}%</td>
                        <td style={{ padding: "5px 8px" }}>{dbFn(ch.delta_ctr)}</td>
                        <td style={{ padding: "5px 8px" }}>{dbFn(ch.delta_cr_cart)}</td>
                        <td style={{ padding: "5px 8px" }}>{dbFn(ch.delta_cr)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Charts — stacked vertically for better readability */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
            <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Выручка / Расходы по дням</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={revChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                <XAxis dataKey="date" tick={{ fill: C.textMute, fontSize: 9 }} />
                <YAxis yAxisId="l" tick={{ fill: C.blue, fontSize: 9 }} tickFormatter={fAxis} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: C.red, fontSize: 9 }} tickFormatter={fAxis} />
                <Tooltip cursor={{ fill: "transparent", stroke: "transparent" }} content={<ChartTooltip formatter={(v: number) => fR(v)} />} />
                <Bar yAxisId="l" dataKey="rev" fill={C.blue + "40"} stroke={C.blue} name="Выручка" radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cost" stroke={C.red} name="Расходы" strokeWidth={2} dot={{ r: 3, fill: C.red }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 12, height: 12, background: C.blue + "40", border: `1.5px solid ${C.blue}`, borderRadius: 2 }} /><span style={{ color: C.textSec, fontSize: 10 }}>Выручка (лев.)</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 14, height: 3, background: C.red, borderRadius: 2 }} /><span style={{ color: C.textSec, fontSize: 10 }}>Расходы рекл. (прав.)</span></div>
            </div>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
            <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Конверсии по дням</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={convChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                <XAxis dataKey="date" tick={{ fill: C.textMute, fontSize: 9 }} />
                <YAxis tick={{ fill: C.textMute, fontSize: 9 }} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Tooltip cursor={{ fill: "transparent", stroke: "transparent" }} content={<ChartTooltip formatter={(v: number) => fP(v)} />} />
                <Line type="monotone" dataKey="ctr" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} name="CTR" />
                <Line type="monotone" dataKey="cr_cart" stroke={C.yellow} strokeWidth={2} dot={{ r: 3 }} name="CR корзина" />
                <Line type="monotone" dataKey="cr" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} name="CR заказ" />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 14, height: 3, background: C.blue, borderRadius: 2 }} /><span style={{ color: C.textSec, fontSize: 10 }}>CTR</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 14, height: 3, background: C.yellow, borderRadius: 2 }} /><span style={{ color: C.textSec, fontSize: 10 }}>CR корзина</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 14, height: 3, background: C.green, borderRadius: 2 }} /><span style={{ color: C.textSec, fontSize: 10 }}>CR заказ</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═══════════════════════════════════════
export default function DashboardPage() {
  const [DAYS, setDAYS] = useState<string[]>([]);
  const [RAW, setRAW] = useState<RawSKU[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false); // подгрузка истории
  const [loadedFrom, setLoadedFrom] = useState<string>('9999-01-01'); // самая ранняя загруженная дата
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0); // 0=auth,1=fetch,2=parse
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [fMgr, setFMgr] = useState("");
  const [fCat, setFCat] = useState("");
  const [fNew, setFNew] = useState("");

  const [drS, setDrS] = useState(0);
  const [drE, setDrE] = useState(0);
  const [calOpen, setCalOpen] = useState(false);
  const [calS, setCalS] = useState<number | null>(null);  // index in DAYS
  const [pendingCalS, setPendingCalS] = useState<string | null>(null); // label выбранный до загрузки
  const [pendingCalE, setPendingCalE] = useState<string | null>(null);
  const [calE, setCalE] = useState<number | null>(null);  // index in DAYS
  const [calPhase, setCalPhase] = useState(0);             // 0=pick start, 1=pick end
  const [calMonth, setCalMonth] = useState<number>(0);     // 0-based month (0=Jan)
  const [calYear, setCalYear] = useState<number>(2026);

  const [tab, setTab] = useState("overview");
  const [tblSort, setTblSort] = useState({ field: "_rev_period", dir: -1 });
  const [tblOffset, setTblOffset] = useState(0);
  const [tFilt, setTFilt] = useState({ oos: "", drr: "", mrg: "", adv: "" });
  const [alertFilter, setAlertFilter] = useState<string | null>(null);

  const [ptSort, setPtSort] = useState({ field: "pct", dir: -1 });
  const [pfDir, setPfDir] = useState("");
  const [pfMgr, setPfMgr] = useState("");
  const [pfCat, setPfCat] = useState("");
  const [pfCtr, setPfCtr] = useState("");
  const [pfCrCrt, setPfCrCrt] = useState("");
  const [pfCr, setPfCr] = useState("");
  const [pfCpo, setPfCpo] = useState("");
  const [pfCpm, setPfCpm] = useState("");
  const [pfCpc, setPfCpc] = useState("");

  const [modalSku, setModalSku] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string>("viewer");

  // Analytics tab state
  const [anSearch, setAnSearch] = useState("");
  const [anMgr, setAnMgr] = useState("");
  const [anRevDir, setAnRevDir] = useState("");
  const [anChmdDir, setAnChmdDir] = useState("");
  const [anMrgDir, setAnMrgDir] = useState("");
  const [anDrrDir, setAnDrrDir] = useState("");
  const [anMinRev, setAnMinRev] = useState("");
  const [anExpanded, setAnExpanded] = useState<Set<string>>(new Set());
  const [anSort, setAnSort] = useState<{ field: string; dir: number }>({ field: "rev", dir: -1 });

  // Niches tab state
  const [nichesData, setNichesData] = useState<any[]>([]);
  const [nichesLoading, setNichesLoading] = useState(false);
  const [nichesLoaded, setNichesLoaded] = useState(false);
  const [nSearch, setNSearch] = useState("");
  const [nCat, setNCat] = useState("");
  const [nSeason, setNSeason] = useState("");
  const [nSeasonStart, setNSeasonStart] = useState("");
  const [nTopMonth, setNTopMonth] = useState("");
  const [nSort, setNSort] = useState<{ field: string; dir: number }>({ field: "score", dir: -1 });
  const [nExpanded, setNExpanded] = useState<Set<string>>(new Set());
  const [nModalNiche, setNModalNiche] = useState<any | null>(null);

  // ─── Вспомогательная функция: получить токен из localStorage ───
  const getToken = (): string | null => {
    try {
      const t = localStorage.getItem('sb_access_token');
      if (t) return t;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.access_token) return parsed.access_token;
          }
        }
      }
    } catch {}
    return null;
  };

  // ─── Загрузка истории с указанной даты ───────────────────────
  // Не грузит повторно если данные уже есть (loadedFrom <= fromDate)
  const loadHistory = async (fromDate: string): Promise<boolean> => {
    if (fromDate >= loadedFrom) return true; // уже загружено
    const token = getToken();
    if (!token) return false;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/dashboard-data?from=${fromDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const data: DashboardData = await res.json();
      const days = data.DAYS || [];
      setDAYS(days);
      setRAW(data.RAW || []);
      setLoadedFrom(fromDate);
      return true;
    } catch { return false; } finally {
      setHistoryLoading(false);
    }
  };

  // ─── Load data ───
  useEffect(() => {
    const loadData = async () => {
      try {
        const token = getToken();

        if (!token) {
          // Not logged in → redirect to login with return URL
          window.location.href = '/login?next=/dashboard';
          return;
        }

        setLoadingStep(1);
        const res = await fetch("/api/dashboard-data", {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Token expired → clear and redirect to login
        if (res.status === 401) {
          localStorage.removeItem('sb_access_token');
          window.location.href = '/login?next=/dashboard';
          return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        setLoadingStep(2);
        const data: DashboardData = await res.json();
        const days = data.DAYS || [];
        const lastIdx = days.length - 1;
        const defaultStart = Math.max(0, lastIdx - 6); // показываем последние 7 дней по умолчанию
        setDAYS(days);
        setRAW(data.RAW || []);
        setUserRole(data.userRole || 'viewer');
        setLoadedFrom('2026-02-01'); // начальная загрузка всегда с 01.02
        setDrS(defaultStart);
        setDrE(lastIdx);
        setCalS(defaultStart);
        setCalE(lastIdx);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // ─── Derived data ───
  const managers = useMemo(() => [...new Set(RAW.map((r) => r.mgr).filter(Boolean))].sort(), [RAW]);
  const categories = useMemo(() => [...new Set(RAW.map((r) => r.cat).filter(Boolean))].sort(), [RAW]);

  const FLT = useMemo(() => {
    const q = search.toLowerCase();
    return RAW
      .filter((r) => r.mgr && r.mgr !== "nan" && r.mgr.trim() !== "")
      .map((r) => recompute(r, drS, drE))
      .filter((r) => {
        if (fMgr && r.mgr !== fMgr) return false;
        if (fCat && r.cat !== fCat) return false;
        if (fNew === "new" && !r.is_new) return false;
        if (fNew === "old" && r.is_new) return false;
        if (q && !`${r.sku} ${r.name} ${r.brand} ${r.pred}`.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [RAW, drS, drE, search, fMgr, fCat, fNew]);

  // SKU grouped by subject (pred) for niches tab
  const skuByPred = useMemo(() => {
    const map = new Map<string, ComputedSKU[]>();
    FLT.forEach(r => {
      const key = (r.pred || "").trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return map;
  }, [FLT]);

  // ─── Alerts ───
  const alerts = useMemo(() => {
    const d = FLT;
    const oosWithAd = d.filter((r) => r._oosst === "red" && r._cost_period > 0);
    const wasted = sum(oosWithAd.map((r) => r._cost_period || 0));
    const potential = d.filter((r) => r._ctr_period != null && r._cr_period != null && r._ctr_period > 0.03 && r._cr_period < 0.01 && r._oosst !== "red");
    const canBoost = d.filter((r) => r.margin_pct != null && r.margin_pct >= 20 && r._drr_period != null && r._drr_period < (r.margin_pct ?? 0) / 200 && r._oosst !== "red");
    const riskyNew = d.filter((r) => r.is_new && (r._rev_period == null || r._rev_period < 5000) && r._oosst !== "red");
    const highCpo = d.filter((r) => {
      if (!r._cost_period || !r._rev_period || !r.price || r.price <= 0) return false;
      const orders = r._rev_period / r.price;
      return orders > 0 && r._cost_period / orders > r.price * 0.3;
    });
    return [
      { type: oosWithAd.length > 0 ? "danger" : "success", icon: "🚨", title: "Стоп реклама: OOS + расходы", count: oosWithAd.length, desc: oosWithAd.length > 0 ? `${oosWithAd.length} товаров без остатков, но реклама идёт. Слив: ~${fM(wasted)}` : "Нет товаров с OOS и активной рекламой", filterFn: "oosAd" },
      { type: potential.length > 0 ? "info" : "success", icon: "🚀", title: "Потенциал роста", count: potential.length, desc: potential.length > 0 ? `${potential.length} товаров с CTR>${fP(0.03)} но CR<${fP(0.01)}` : "Нет товаров с высоким CTR и низким CR", filterFn: "potential" },
      { type: canBoost.length > 0 ? "success" : "success", icon: "📈", title: "Можно увеличить рекламу", count: canBoost.length, desc: canBoost.length > 0 ? `${canBoost.length} товаров: маржа≥20%, ДРР < половины маржи` : "Нет товаров с запасом для роста", filterFn: "canBoost" },
      { type: riskyNew.length > 0 ? "warning" : "success", icon: "⭐", title: "Новинки в зоне риска", count: riskyNew.length, desc: riskyNew.length > 0 ? `${riskyNew.length} новинок с выручкой <5К` : "Все новинки OK", filterFn: "riskyNew" },
      { type: highCpo.length > 0 ? "warning" : "success", icon: "💸", title: "Высокий CPO", count: highCpo.length, desc: highCpo.length > 0 ? `${highCpo.length} товаров с CPO > 30% от цены` : "Нет критично высокого CPO", filterFn: "highCpo" },
    ];
  }, [FLT]);

  // ─── Table data ───
  const tblData = useMemo(() => {
    let data = FLT.filter((r) => {
      if (tFilt.oos && r._oosst !== tFilt.oos) return false;
      if (tFilt.drr === "over" && !r._drrover) return false;
      if (tFilt.drr === "ok" && r._drrover) return false;
      if (tFilt.mrg && r._mrgst !== tFilt.mrg) return false;
      if (tFilt.adv === "adv" && !(r.adv_share && r.adv_share > 0)) return false;
      return true;
    });
    if (alertFilter) {
      const filters: Record<string, (r: ComputedSKU) => boolean> = {
        oosAd: (r) => r._oosst === "red" && r._cost_period > 0,
        potential: (r) => r._ctr_period != null && r._cr_period != null && r._ctr_period > 0.03 && r._cr_period < 0.01 && r._oosst !== "red",
        canBoost: (r) => r.margin_pct != null && r.margin_pct >= 20 && r._drr_period != null && r._drr_period < (r.margin_pct ?? 0) / 200 && r._oosst !== "red",
        riskyNew: (r) => r.is_new && (r._rev_period == null || r._rev_period < 5000) && r._oosst !== "red",
        highCpo: (r) => { if (!r._cost_period || !r._rev_period || !r.price || r.price <= 0) return false; const o = r._rev_period / r.price; return o > 0 && r._cost_period / o > r.price * 0.3; },
      };
      if (filters[alertFilter]) data = data.filter(filters[alertFilter]);
    }
    return [...data].sort((a, b) => {
      const av = a[tblSort.field] ?? -Infinity, bv = b[tblSort.field] ?? -Infinity;
      return typeof av === "string" ? tblSort.dir * (av as string).localeCompare(bv as string) : tblSort.dir * ((av as number) - (bv as number));
    });
  }, [FLT, tFilt, alertFilter, tblSort]);

  // ─── Price changes ───
  const priceRows = useMemo(() => {
    const activeDates = DAYS.slice(drS, drE + 1);
    const rows: any[] = [];
    FLT.forEach((r) => {
      (r.price_changes || []).forEach((ch) => {
        if (!activeDates.includes(ch.date)) return;
        if (pfDir === "up" && ch.pct <= 0) return;
        if (pfDir === "dn" && ch.pct >= 0) return;
        if (pfMgr && r.mgr !== pfMgr) return;
        if (pfCat && r.cat !== pfCat) return;
        if (pfCtr === "pos" && !(ch.delta_ctr != null && ch.delta_ctr > 0)) return;
        if (pfCtr === "neg" && !(ch.delta_ctr != null && ch.delta_ctr < 0)) return;
        if (pfCrCrt === "pos" && !(ch.delta_cr_cart != null && ch.delta_cr_cart > 0)) return;
        if (pfCrCrt === "neg" && !(ch.delta_cr_cart != null && ch.delta_cr_cart < 0)) return;
        if (pfCr === "pos" && !(ch.delta_cr != null && ch.delta_cr > 0)) return;
        if (pfCr === "neg" && !(ch.delta_cr != null && ch.delta_cr < 0)) return;
        if (pfCpm === "pos" && !(ch.delta_cpm != null && ch.delta_cpm > 0)) return;
        if (pfCpm === "neg" && !(ch.delta_cpm != null && ch.delta_cpm < 0)) return;
        if (pfCpc === "pos" && !(ch.delta_cpc != null && ch.delta_cpc > 0)) return;
        if (pfCpc === "neg" && !(ch.delta_cpc != null && ch.delta_cpc < 0)) return;
        const di = DAYS.indexOf(ch.date);
        const costBefore = di > 0 && r.cost_d?.[di - 1] != null ? r.cost_d[di - 1] : null;
        const costAfter = di < DAYS.length - 1 && r.cost_d?.[di + 1] != null ? r.cost_d[di + 1] : null;
        const orders = r.price && r.price > 0 && r._rev_period > 0 ? r._rev_period / r.price : 0;
        const cpo = orders > 0 ? (r._cost_period || 0) / orders : null;
        if (pfCpo === "high" && !(cpo != null && cpo > 200)) return;
        if (pfCpo === "low" && !(cpo != null && cpo <= 200)) return;
        rows.push({ sku: r.sku, name: r.name, mgr: r.mgr, ...ch, cost_before: costBefore, cost_after: costAfter, cpo });
      });
    });
    return [...rows].sort((a, b) => {
      const av = a[ptSort.field] ?? -Infinity, bv = b[ptSort.field] ?? -Infinity;
      return typeof av === "string" ? ptSort.dir * av.localeCompare(bv) : ptSort.dir * (av - bv);
    });
  }, [FLT, DAYS, drS, drE, pfDir, pfMgr, pfCat, pfCtr, pfCrCrt, pfCr, pfCpo, pfCpm, pfCpc, ptSort]);

  // ─── Chart data ───
  const chartDays = DAYS.slice(drS, drE + 1);
  const revDynData = useMemo(() => chartDays.map((d, i) => ({
    date: d, rev: sum(FLT.map((r) => r.rev_d?.[drS + i] || 0)), cost: sum(FLT.map((r) => r.cost_d?.[drS + i] || 0)),
  })), [FLT, chartDays, drS]);


  const funnelData = useMemo(() => chartDays.map((d, i) => {
    const idx = drS + i;
    // Для каждого дня: sum(ctr_sku * rev_sku) / sum(rev_sku)
    let ctrW = 0, crCartW = 0, crW = 0, revSum = 0;
    for (const r of FLT) {
      const rv = r.rev_d?.[idx] || 0;
      if (rv <= 0) continue;
      revSum += rv;
      if (r.ctr_d?.[idx] != null) ctrW += (r.ctr_d[idx] as number) * rv;
      if (r.cr_cart_d?.[idx] != null) crCartW += (r.cr_cart_d[idx] as number) * rv;
      if (r.cr_d?.[idx] != null) crW += (r.cr_d[idx] as number) * rv;
    }
    return {
      date: d,
      ctr: revSum > 0 ? ctrW / revSum : null,
      cr_cart: revSum > 0 ? crCartW / revSum : null,
      cr: revSum > 0 ? crW / revSum : null,
    };
  }), [FLT, chartDays, drS]);

  const trendsData = useMemo(() => {
    const totalRev = sum(FLT.map((r) => sum(r.rev_d || [])));
    const totalChmd = sum(FLT.map((r) => r.chmd || 0));
    const ratio = totalRev > 0 ? totalChmd / totalRev : 0;
    return chartDays.map((d, i) => {
      const dayRev = sum(FLT.map((r) => r.rev_d?.[drS + i] || 0));
      const dayCost = sum(FLT.map((r) => r.cost_d?.[drS + i] || 0));
      return { date: d, rev: dayRev, chmd: dayRev * ratio, cost: dayCost, drr: dayRev > 0 ? dayCost / dayRev : null };
    });
  }, [FLT, chartDays, drS]);

  const comparison = useMemo(() => {
    const periodLen = drE - drS + 1;
    const prevS = Math.max(0, drS - periodLen), prevE = drS - 1;
    if (prevE < 0) return null;
    const sl = (arr: any[], s: number, e: number) => (arr || []).slice(s, e + 1);

    // Weighted average of conversion metric over a slice, weighted by daily revenue
    const weightedSlice = (metricKey: string, revKey: string, s: number, e: number): number | null => {
      let wSum = 0, rSum = 0;
      for (const r of FLT) {
        const metrics = sl((r as any)[metricKey] || [], s, e);
        const revs = sl((r as any)[revKey] || [], s, e);
        for (let j = 0; j < metrics.length; j++) {
          const m = metrics[j], rv = revs[j] || 0;
          if (m != null && rv > 0) { wSum += m * rv; rSum += rv; }
        }
      }
      return rSum > 0 ? wSum / rSum : null;
    };

    return {
      curRev: sum(FLT.map((r) => sum(sl(r.rev_d, drS, drE)))),
      prevRev: sum(FLT.map((r) => sum(sl(r.rev_d, prevS, prevE)))),
      curCost: sum(FLT.map((r) => sum(sl(r.cost_d, drS, drE)))),
      prevCost: sum(FLT.map((r) => sum(sl(r.cost_d, prevS, prevE)))),
      curCtr: weightedSlice('ctr_d', 'rev_d', drS, drE),
      prevCtr: weightedSlice('ctr_d', 'rev_d', prevS, prevE),
      curCrCart: weightedSlice('cr_cart_d', 'rev_d', drS, drE),
      prevCrCart: weightedSlice('cr_cart_d', 'rev_d', prevS, prevE),
      curCr: weightedSlice('cr_d', 'rev_d', drS, drE),
      prevCr: weightedSlice('cr_d', 'rev_d', prevS, prevE),
      curDrr: (() => { const r = sum(FLT.map(r => sum(sl(r.rev_d, drS, drE)))); const c = sum(FLT.map(r => sum(sl(r.cost_d, drS, drE)))); return r > 0 ? c / r : null; })(),
      prevDrr: (() => { const r = sum(FLT.map(r => sum(sl(r.rev_d, prevS, prevE)))); const c = sum(FLT.map(r => sum(sl(r.cost_d, prevS, prevE)))); return r > 0 ? c / r : null; })(),
    };
  }, [FLT, drS, drE]);

  const mgrData = useMemo(() => {
    const map: Record<string, any> = {};
    FLT.forEach((r) => {
      if (!map[r.mgr]) map[r.mgr] = { rev: 0, cost: 0, chmd: 0, cnt: 0, new: 0, mgWeighted: 0, oosR: 0, oosY: 0, drrOver: 0 };
      const m = map[r.mgr];
      m.rev += r._rev_period || 0;
      m.cost += r._cost_period || 0;
      m.chmd += r._chmd_period || 0;
      m.cnt++;
      if (r.is_new) m.new++;
      // Взвешенная маржа: sum(margin * rev)
      m.mgWeighted += (r.margin_pct ?? 0) * (r._rev_period || 0);
      if (r._oosst === "red") m.oosR++;
      if (r._oosst === "yellow") m.oosY++;
      if (r._drrover) m.drrOver++;
    });
    return Object.entries(map).sort((a: any, b: any) => b[1].rev - a[1].rev);
  }, [FLT]);

  const catRanking = useMemo(() => {
    const catMap: Record<string, { rev: number; cnt: number; revPrev: number }> = {};
    FLT.forEach((r) => {
      if (!r.cat) return;
      if (!catMap[r.cat]) catMap[r.cat] = { rev: 0, cnt: 0, revPrev: 0 };
      catMap[r.cat].rev += r._rev_period || 0; catMap[r.cat].cnt++;
      const pLen = drE - drS + 1, pS = Math.max(0, drS - pLen), pE = drS - 1;
      if (pE >= 0) catMap[r.cat].revPrev += sum((r.rev_d || []).slice(pS, pE + 1));
    });
    const byRev = Object.entries(catMap).sort((a, b) => b[1].rev - a[1].rev);
    const byDyn = Object.entries(catMap).filter(([, d]) => d.revPrev > 0).map(([name, d]) => ({
      name, rev: d.rev, revPrev: d.revPrev, revChange: d.rev - d.revPrev,
      delta: (d.rev - d.revPrev) / d.revPrev, cnt: d.cnt,
    })).sort((a, b) => b.revChange - a.revChange);  // по убыванию изменения выручки
    return { byRev, byDyn };
  }, [FLT, drS, drE]);

  const mrgDist = useMemo(() => {
    const t = FLT.length || 1;
    return { red: FLT.filter((x) => x._mrgst === "red").length, yellow: FLT.filter((x) => x._mrgst === "yellow").length, green: FLT.filter((x) => x._mrgst === "green").length, total: t };
  }, [FLT]);

  const advOrg = useMemo(() => {
    const advT = sum(FLT.map((r) => (r.adv_share || 0) * (r._rev_period || 0)));
    const orgT = sum(FLT.map((r) => (1 - (r.adv_share || 0)) * (r._rev_period || 0)));
    return { adv: advT, org: orgT, total: (advT + orgT) || 1 };
  }, [FLT]);

  const drrMgrData = useMemo(() => {
    const map: Record<string, { rev: number; cost: number; revPlan: number; costPlan: number }> = {};
    FLT.forEach((r) => {
      if (!map[r.mgr]) map[r.mgr] = { rev: 0, cost: 0, revPlan: 0, costPlan: 0 };
      map[r.mgr].rev += r._rev_period || 0;
      map[r.mgr].cost += r._cost_period || 0;
      // ДРР план = spend_plan / revenue_plan (если есть rev_plan, вычисляем spend_plan = drr_plan * rev_plan)
      if (r.rev_plan && r.drr_plan != null) {
        map[r.mgr].revPlan += r.rev_plan;
        map[r.mgr].costPlan += r.drr_plan * r.rev_plan;
      }
    });
    return Object.entries(map).map(([name, d]) => ({
      name,
      fact: d.rev > 0 ? d.cost / d.rev : null,
      plan: d.revPlan > 0 ? d.costPlan / d.revPlan : null,
    }));
  }, [FLT]);

  // ─── Analytics tab data ───
  const analyticsData = useMemo(() => {
    const periodLen = drE - drS + 1;
    const prevS = Math.max(0, drS - periodLen), prevE = drS - 1;
    const hasPrev = prevE >= 0;
    const sl = (arr: any[], s: number, e: number) => (arr || []).slice(s, e + 1);

    // Build category → subject → SKU tree
    type SKURow = {
      sku: number; name: string; mgr: string; cat: string; pred: string;
      rev: number; revPrev: number; cost: number; costPrev: number;
      chmd: number; chmdPrev: number; margin: number | null;
      drrFact: number | null; ctr: number | null; cr: number | null;
      stockTotal: number;
    };

    const allRows: SKURow[] = FLT.map(r => {
      const rev = r._rev_period || 0;
      const cost = r._cost_period || 0;
      const revPrev = hasPrev ? sum(sl(r.rev_d, prevS, prevE)) : 0;
      const costPrev = hasPrev ? sum(sl(r.cost_d, prevS, prevE)) : 0;
      const chmd = r._chmd_period || 0;
      const chmdPrev = hasPrev && r.chmd_d ? sum(sl(r.chmd_d, prevS, prevE)) : 0;
      return {
        sku: r.sku, name: r.name, mgr: r.mgr, cat: r.cat, pred: r.pred,
        rev, revPrev, cost, costPrev, chmd, chmdPrev,
        margin: r.margin_pct, drrFact: r._drr_period, ctr: r._ctr_period, cr: r._cr_period,
        stockTotal: r.stock_total ?? 0,
      };
    });

    // Aggregate
    type AggRow = {
      name: string; key: string; level: 'cat' | 'pred' | 'sku';
      rev: number; revPrev: number; revDelta: number | null;
      cost: number; costPrev: number;
      chmd: number; chmdPrev: number; chmdDelta: number | null;
      marginWeighted: number;
      marginWeightedPrev: number;
      drr: number | null;
      drrPrev: number | null;
      costDelta: number | null;
      stockTotal: number;
      skuCount: number;
      children?: AggRow[];
      skuData?: SKURow;
    };

    const aggregate = (rows: SKURow[]): { rev: number; revPrev: number; cost: number; costPrev: number; chmd: number; chmdPrev: number; marginW: number; marginWPrev: number; stockTotal: number } => {
      let rev = 0, revPrev = 0, cost = 0, costPrev = 0, chmd = 0, chmdPrev = 0, marginW = 0, marginWPrev = 0, stockTotal = 0;
      for (const r of rows) {
        rev += r.rev; revPrev += r.revPrev; cost += r.cost; costPrev += r.costPrev;
        chmd += r.chmd; chmdPrev += r.chmdPrev; marginW += (r.margin ?? 0) * r.rev; marginWPrev += (r.margin ?? 0) * r.revPrev;
        stockTotal += r.stockTotal;
      }
      return { rev, revPrev, cost, costPrev, chmd, chmdPrev, marginW, marginWPrev, stockTotal };
    };

    const makeAgg = (name: string, key: string, level: 'cat' | 'pred' | 'sku', rows: SKURow[], children?: AggRow[]): AggRow => {
      const a = aggregate(rows);
      return {
        name, key, level, rev: a.rev, revPrev: a.revPrev,
        revDelta: a.revPrev > 0 ? (a.rev - a.revPrev) / a.revPrev : null,
        cost: a.cost, costPrev: a.costPrev,
        costDelta: a.costPrev > 0 ? (a.cost - a.costPrev) / a.costPrev : null,
        chmd: a.chmd, chmdPrev: a.chmdPrev,
        chmdDelta: a.chmdPrev > 0 ? (a.chmd - a.chmdPrev) / a.chmdPrev : null,
        marginWeighted: a.marginW,
        marginWeightedPrev: a.marginWPrev,
        drr: a.rev > 0 ? a.cost / a.rev : null,
        drrPrev: a.revPrev > 0 ? a.costPrev / a.revPrev : null,
        stockTotal: a.stockTotal,
        skuCount: rows.length, children,
      };
    };

    // Group by category → subject
    const catMap: Record<string, SKURow[]> = {};
    for (const r of allRows) {
      if (!catMap[r.cat]) catMap[r.cat] = [];
      catMap[r.cat].push(r);
    }

    const categories: AggRow[] = Object.entries(catMap).map(([cat, catRows]) => {
      // Group by subject within category
      const predMap: Record<string, SKURow[]> = {};
      for (const r of catRows) {
        const pred = r.pred || "Без предмета";
        if (!predMap[pred]) predMap[pred] = [];
        predMap[pred].push(r);
      }

      const subjects: AggRow[] = Object.entries(predMap).map(([pred, predRows]) => {
        const skuChildren: AggRow[] = predRows.map(r => ({
          name: r.name, sku_id: r.sku, key: `sku-${r.sku}`, level: 'sku' as const,
          rev: r.rev, revPrev: r.revPrev,
          revDelta: r.revPrev > 0 ? (r.rev - r.revPrev) / r.revPrev : null,
          cost: r.cost, costPrev: r.costPrev,
          costDelta: r.costPrev > 0 ? (r.cost - r.costPrev) / r.costPrev : null,
          chmd: r.chmd, chmdPrev: r.chmdPrev,
          chmdDelta: r.chmdPrev > 0 ? (r.chmd - r.chmdPrev) / r.chmdPrev : null,
          marginWeighted: (r.margin ?? 0) * r.rev,
          marginWeightedPrev: (r.margin ?? 0) * r.revPrev,
          drr: r.rev > 0 ? r.cost / r.rev : null,
          drrPrev: r.revPrev > 0 ? r.costPrev / r.revPrev : null,
          stockTotal: r.stockTotal,
          skuCount: 1, skuData: r,
        }));
        return makeAgg(pred, `pred-${cat}-${pred}`, 'pred', predRows, skuChildren);
      }).sort((a, b) => b.rev - a.rev);

      return makeAgg(cat, `cat-${cat}`, 'cat', catRows, subjects);
    }).sort((a, b) => b.rev - a.rev);

    return { categories, hasPrev };
  }, [FLT, drS, drE]);

  // Filter analytics
  const filteredAnalytics = useMemo(() => {
    const q = anSearch.toLowerCase();
    const minRev = anMinRev === "100k" ? 100000 : anMinRev === "500k" ? 500000 : anMinRev === "1m" ? 1000000 : 0;

    return analyticsData.categories.filter(cat => {
      if (q && !cat.name.toLowerCase().includes(q) && !cat.children?.some(p => p.name.toLowerCase().includes(q) || p.children?.some(s => s.name.toLowerCase().includes(q)))) return false;
      if (anMgr && !FLT.some(r => r.cat === cat.name && r.mgr === anMgr)) return false;
      if (minRev > 0 && cat.rev < minRev) return false;
      if (anRevDir === "up" && !(cat.revDelta != null && cat.revDelta > 0)) return false;
      if (anRevDir === "dn" && !(cat.revDelta != null && cat.revDelta < 0)) return false;
      if (anChmdDir === "up" && !(cat.chmdDelta != null && cat.chmdDelta > 0)) return false;
      if (anChmdDir === "dn" && !(cat.chmdDelta != null && cat.chmdDelta < 0)) return false;
      if (anMrgDir === "up" && !(cat.rev > 0 && cat.revPrev > 0 && cat.marginWeighted / cat.rev > cat.marginWeightedPrev / cat.revPrev)) return false;
      if (anMrgDir === "dn" && !(cat.rev > 0 && cat.revPrev > 0 && cat.marginWeighted / cat.rev < cat.marginWeightedPrev / cat.revPrev)) return false;
      if (anDrrDir === "up" && !(cat.drr != null && cat.drrPrev != null && cat.drr > cat.drrPrev)) return false;
      if (anDrrDir === "dn" && !(cat.drr != null && cat.drrPrev != null && cat.drr < cat.drrPrev)) return false;
      return true;
    }).sort((a, b) => {
      const getValue = (row: typeof a): number => {
        const f = anSort.field;
        if (f === 'rev') return row.rev;
        if (f === 'revDelta') return row.revDelta ?? -999;
        if (f === 'chmd') return row.chmd;
        if (f === 'chmdDelta') return row.chmdDelta ?? -999;
        if (f === 'margin') return row.rev > 0 ? row.marginWeighted / row.rev : -999;
        if (f === 'marginDelta') { const c = row.rev > 0 ? row.marginWeighted / row.rev : 0; const p = row.revPrev > 0 ? row.marginWeightedPrev / row.revPrev : 0; return p > 0 ? c - p : -999; }
        if (f === 'drr') return row.drr ?? -999;
        if (f === 'drrDelta') { return (row.drr ?? 0) - (row.drrPrev ?? 0); }
        if (f === 'cost') return row.cost;
        if (f === 'costDelta') return row.costDelta ?? -999;
        if (f === 'skuCount') return row.skuCount;
        return row.rev;
      };
      return anSort.dir * (getValue(a) - getValue(b));
    });
  }, [analyticsData, anSearch, anMgr, anRevDir, anChmdDir, anMrgDir, anDrrDir, anMinRev, anSort, FLT]);

  const toggleExpand = (key: string) => {
    setAnExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };

  // ─── Calendar helpers ───
  // Parse DAYS ('DD.MM') into full date info, assuming current year range
  const daysFullDates = useMemo(() => {
    if (!DAYS.length) return [];
    // Determine year from data context — assume latest year or 2026
    // DAYS are 'DD.MM', we need to figure out the year
    // Simple heuristic: if months go 12→1, year wraps
    let year = new Date().getFullYear();
    return DAYS.map((d, i) => {
      const [dd, mm] = d.split('.').map(Number);
      return { idx: i, day: dd, month: mm - 1, year, label: d }; // month 0-based
    });
  }, [DAYS]);

  // Available months in data
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    daysFullDates.forEach(d => set.add(`${d.year}-${d.month}`));
    return [...set].map(k => { const [y, m] = k.split('-').map(Number); return { year: y, month: m }; })
      .sort((a, b) => a.year * 12 + a.month - b.year * 12 - b.month);
  }, [daysFullDates]);

  // DAYS index by 'DD.MM' for quick lookup
  const dayIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    DAYS.forEach((d, i) => m.set(d, i));
    return m;
  }, [DAYS]);

  // Открываем календарь на текущем месяце
  useEffect(() => {
    if (availableMonths.length > 0) {
      const now = new Date();
      setCalMonth(now.getMonth());
      setCalYear(now.getFullYear());
    }
  }, [availableMonths]);

  // После подгрузки истории — применяем отложенный выбор дат
  useEffect(() => {
    if (!pendingCalS || historyLoading) return;
    const sLabel = pendingCalS;
    const eLabel = pendingCalE ?? sLabel;
    const sIdx = dayIndexMap.get(sLabel);
    const eIdx = dayIndexMap.get(eLabel);
    if (sIdx !== undefined && eIdx !== undefined) {
      setDrS(Math.min(sIdx, eIdx));
      setDrE(Math.max(sIdx, eIdx));
      setCalS(Math.min(sIdx, eIdx));
      setCalE(Math.max(sIdx, eIdx));
      setPendingCalS(null);
      setPendingCalE(null);
    }
  }, [DAYS, historyLoading, pendingCalS, pendingCalE, dayIndexMap]);

  const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  // Build calendar grid for current calMonth/calYear
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Monday=0
    const daysInMonth = lastDay.getDate();

    const cells: { day: number; month: number; year: number; label: string; idx: number | null; isCurrentMonth: boolean }[] = [];

    // Previous month fill
    const prevMonthLastDay = new Date(calYear, calMonth, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const m = calMonth === 0 ? 11 : calMonth - 1;
      const y = calMonth === 0 ? calYear - 1 : calYear;
      const label = `${String(d).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}`;
      cells.push({ day: d, month: m, year: y, label, idx: dayIndexMap.get(label) ?? null, isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const label = `${String(d).padStart(2, '0')}.${String(calMonth + 1).padStart(2, '0')}`;
      cells.push({ day: d, month: calMonth, year: calYear, label, idx: dayIndexMap.get(label) ?? null, isCurrentMonth: true });
    }

    // Next month fill (to complete 6 rows)
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const m = calMonth === 11 ? 0 : calMonth + 1;
      const y = calMonth === 11 ? calYear + 1 : calYear;
      const label = `${String(d).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}`;
      cells.push({ day: d, month: m, year: y, label, idx: dayIndexMap.get(label) ?? null, isCurrentMonth: false });
    }

    return cells;
  }, [calMonth, calYear, dayIndexMap]);

  const calClick = (cell: { idx: number | null; label: string; isCurrentMonth: boolean }) => {
    const label = cell.label;
    if (calPhase === 0 || pendingCalS === null) {
      setPendingCalS(label);
      setPendingCalE(label);
      // Если дата уже в данных — синхронизируем calS/calE
      if (cell.idx !== null) { setCalS(cell.idx); setCalE(cell.idx); }
      setCalPhase(1);
    } else {
      setPendingCalE(label);
      if (cell.idx !== null) setCalE(cell.idx);
      setCalPhase(0);
    }
  };

  const calPrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
    else setCalMonth(calMonth - 1);
  };
  const calNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
    else setCalMonth(calMonth + 1);
  };

  const applyDR = () => {
    const sLabel = pendingCalS;
    const eLabel = pendingCalE ?? sLabel;
    if (!sLabel || !eLabel) return;

    const labelToISO = (label: string) => {
      const [dd, mm] = label.split('.');
      return `2026-${mm}-${dd}`;
    };

    const sISO = labelToISO(sLabel);
    const eISO = labelToISO(eLabel);
    const earlierISO = sISO < eISO ? sISO : eISO;

    // Если выбранные даты уже в данных — применяем сразу, без загрузки
    const sIdx = dayIndexMap.get(sLabel) ?? null;
    const eIdx = dayIndexMap.get(eLabel) ?? null;
    if (sIdx !== null && eIdx !== null) {
      setDrS(Math.min(sIdx, eIdx));
      setDrE(Math.max(sIdx, eIdx));
      setCalS(Math.min(sIdx, eIdx));
      setCalE(Math.max(sIdx, eIdx));
      setPendingCalS(null);
      setPendingCalE(null);
      setCalOpen(false);
      return;
    }

    // Нужна загрузка — загружаем с более ранней даты, pending применится через useEffect
    setCalOpen(false);
    loadHistory(earlierISO);
  };
  const resetDR = () => { setDrS(0); setDrE(DAYS.length - 1); setCalS(0); setCalE(DAYS.length - 1); setCalOpen(false); };

  const goTable = useCallback((filters: any) => {
    setAlertFilter(null); setTFilt({ oos: filters.oos || "", drr: filters.drr || "", mrg: filters.mrg || "", adv: filters.adv || "" });
    if (filters.isNew != null) setFNew(filters.isNew ? "new" : "");
    setTblOffset(0); setTab("table");
  }, []);

  const goAlertTable = useCallback((filterName: string) => {
    setTFilt({ oos: "", drr: "", mrg: "", adv: "" }); setAlertFilter(filterName); setTblOffset(0); setTab("table");
  }, []);

  const modalData = useMemo(() => {
    if (!modalSku) return null;
    return FLT.find((r) => r.sku === modalSku) || RAW.map((r) => recompute(r, drS, drE)).find((r) => r.sku === modalSku) || null;
  }, [modalSku, FLT, RAW, drS, drE]);

  // ─── Loading / Error ───
  const loadingSteps = [
    { label: "Авторизация",           pct: 15 },
    { label: "Загрузка данных",       pct: 55 },
    { label: "Подготовка дашборда",   pct: 90 },
  ];
  const currentStep = loadingSteps[loadingStep] || loadingSteps[0];

  if (loading) return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ textAlign: "center", width: 320 }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>📦</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Загрузка дашборда...</div>
        <div style={{ color: C.textMute, fontSize: 12, marginBottom: 24 }}>Получаем данные из Supabase</div>

        {/* Полоса загрузки */}
        <div style={{ width: "100%", height: 4, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
          <div style={{
            height: "100%", borderRadius: 4,
            background: `linear-gradient(90deg, ${C.blue}, ${C.purple})`,
            animation: "dashLoad 1.8s ease-in-out infinite",
          }} />
        </div>
        <div style={{ color: C.textDim, fontSize: 11 }}>Это займёт несколько секунд</div>

        <style>{`
          @keyframes dashLoad {
            0%   { width: 0%;   margin-left: 0; }
            50%  { width: 70%;  margin-left: 15%; }
            100% { width: 0%;   margin-left: 100%; }
          }
        `}</style>
      </div>
    </div>
  );


  if (error) return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background: C.card, borderRadius: 14, padding: 30, maxWidth: 400, textAlign: "center", border: `1px solid ${C.red}` }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{error.includes('авториз') || error.includes('401') ? '🔒' : '⚠️'}</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          {error.includes('авториз') || error.includes('401') ? 'Требуется авторизация' : 'Ошибка загрузки'}
        </div>
        <div style={{ color: C.textSec, fontSize: 12, marginBottom: 16 }}>{error}</div>
        {(error.includes('авториз') || error.includes('401')) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => window.location.href = '/login'} style={{ background: C.blue, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontWeight: 600 }}>
              Войти в систему
            </button>
            <button onClick={() => window.location.reload()} style={{ background: 'transparent', color: C.textSec, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              Обновить страницу
            </button>
          </div>
        ) : (
          <button onClick={() => window.location.reload()} style={{ background: C.blue, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontWeight: 600 }}>
            Попробовать снова
          </button>
        )}
      </div>
    </div>
  );

  const tblPage = tblData.slice(tblOffset, tblOffset + PAGE_SIZE);
  const tblPages = Math.ceil(tblData.length / PAGE_SIZE);
  const tblCurPage = Math.floor(tblOffset / PAGE_SIZE) + 1;
  const mgrPieData = mgrData.map(([name, d]: any) => ({ name, value: d.rev }));
  const mgrTotal = sum(mgrPieData.map((d: any) => d.value)) || 1;
  const advOrgPie = [{ name: "Рекламные", value: advOrg.adv, color: C.yellow }, { name: "Органические", value: advOrg.org, color: C.green }];

  const dbFn = (v: number | null) => {
    if (v == null) return <span style={{ color: C.textDim }}>—</span>;
    const up = v > 0;
    return <span style={{ color: up ? C.green : C.red, fontWeight: 700 }}>{up ? "▲ +" : "▼ "}{(Math.abs(v) * 100).toFixed(1)}%</span>;
  };

  // ═══════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: "'Segoe UI',system-ui,sans-serif", fontSize: 14 }}>
      {/* Kill Recharts focus outlines and hover borders */}
      <style>{`
        .recharts-wrapper, .recharts-surface, .recharts-bar-rectangle,
        .recharts-rectangle, .recharts-active-bar, .recharts-tooltip-cursor,
        .recharts-bar, .recharts-line, .recharts-area, .recharts-pie {
          outline: none !important;
          stroke-dasharray: none;
        }
        .recharts-wrapper:focus, .recharts-surface:focus,
        .recharts-wrapper *:focus { outline: none !important; }
        .recharts-active-bar { stroke: transparent !important; stroke-width: 0 !important; }
        .recharts-tooltip-cursor { fill: transparent !important; stroke: transparent !important; }
        .recharts-rectangle.recharts-tooltip-cursor { fill: transparent !important; }
        * { scrollbar-width: thin !important; scrollbar-color: #3b4568 #1a1f2e !important; }
        *::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
        *::-webkit-scrollbar-track { background: #1a1f2e !important; border-radius: 3px !important; }
        *::-webkit-scrollbar-thumb { background: #3b4568 !important; border-radius: 3px !important; }
        *::-webkit-scrollbar-thumb:hover { background: #4b5580 !important; }
        *::-webkit-scrollbar-corner { background: #1a1f2e !important; }
        .mini-bar:hover { transform: scaleY(1.3) scaleX(1.2); filter: brightness(1.5); z-index: 1; }
        .sort-btn:hover { background: rgba(59,130,246,0.15) !important; border-color: #3B82F6 !important; }
      `}</style>
      <div style={{ position: "sticky", top: 0, zIndex: 200 }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "11px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: `linear-gradient(135deg,${C.blue},${C.purple})`, borderRadius: 9, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📦</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>WB Новинки</div>
            <div style={{ color: C.textMute, fontSize: 11, marginTop: 1 }}>Wildberries · {FLT.length} SKU · {DAYS.length} дней ({DAYS[0]}–{DAYS[DAYS.length - 1]})</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[{ id: "overview", label: "📊 Обзор" }, { id: "table", label: "📋 Таблица SKU" }, { id: "price", label: "💰 Изменения цен" }, { id: "analytics", label: "📈 Аналитика" }, { id: "niches", label: "📦 Анализ ниш" }, { id: "orders", label: "🛒 Заказ товаров" }, { id: "update", label: "🔄 Обновление данных" }].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? C.blue : "transparent", border: `1px solid ${tab === t.id ? C.blue : C.border}`,
              color: tab === t.id ? "#fff" : C.textSec, borderRadius: 7, padding: "6px 13px", cursor: "pointer", fontWeight: 600, fontSize: 12,
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ═══ GLOBAL FILTERS ═══ */}
      {tab !== "orders" && tab !== "update" && <div style={{ padding: "8px 18px", background: "#131720", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, paddingLeft: 2 }}>🔍 Поиск</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU, название, бренд..."
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", color: C.text, fontSize: 12, outline: "none", width: 190 }} />
        </div>
        <FilterSelect label="Менеджер" value={fMgr} onChange={setFMgr} options={[{ value: "", label: "Все менеджеры" }, ...managers.map((m) => ({ value: m, label: m }))]} />
        <FilterSelect label="Категория" value={fCat} onChange={setFCat} options={[{ value: "", label: "Все категории" }, ...categories.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect label="Товары" value={fNew} onChange={setFNew} options={[{ value: "", label: "Все товары" }, { value: "new", label: "⭐ Только новинки" }, { value: "old", label: "Без новинок" }]} />
        <div style={{ marginLeft: "auto", color: C.textMute, fontSize: 12, alignSelf: "flex-end", paddingBottom: 2 }}>Показано: <b style={{ color: C.text }}>{FLT.length}</b> SKU</div>
      </div>}

      {/* ═══ DATE RANGE ═══ */}
      <div style={{ padding: "7px 18px", background: C.bg, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", position: "relative" }}>
        <span style={{ color: C.textMute, fontSize: 11, fontWeight: 600 }}>📅 Период:</span>
        <div onClick={() => { setCalOpen(!calOpen); if (!calOpen) { setCalS(drS); setCalE(drE); setPendingCalS(DAYS[drS] ?? null); setPendingCalE(DAYS[drE] ?? null); setCalPhase(0); } }}
          style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 12, color: C.textSec, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          📅 <span style={{ color: C.text, fontWeight: 700 }}>{DAYS[drS] === DAYS[drE] ? DAYS[drS] : `${DAYS[drS]} — ${DAYS[drE]}`}</span>
          <span style={{ color: C.blue, fontSize: 10 }}>▼</span>
        </div>

        {calOpen && (
          <div style={{ position: "absolute", top: 42, left: 100, background: C.card, border: `1px solid ${C.blue}`, borderRadius: 12, padding: 16, zIndex: 400, boxShadow: "0 8px 40px rgba(0,0,0,.7)", width: 320 }}>
            {/* Month navigation */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <button onClick={(e) => { e.stopPropagation(); calPrevMonth(); }} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>◀</button>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{MONTH_NAMES[calMonth]} {calYear}</div>
              <button onClick={(e) => { e.stopPropagation(); calNextMonth(); }} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textSec, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>▶</button>
            </div>

            {/* Weekday headers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
              {WEEKDAYS.map(w => (
                <div key={w} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.textMute, padding: "4px 0" }}>{w}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {calendarGrid.map((cell, ci) => {
                const hasData = cell.idx !== null;

                // Используем label-сравнение для выделения — работает даже без данных
                const selS = pendingCalS ?? (calS !== null ? DAYS[calS] : null);
                const selE = pendingCalE ?? (calE !== null ? DAYS[calE] : selS);
                const minLabel = selS && selE ? (selS < selE ? selS : selE) : selS;
                const maxLabel = selS && selE ? (selS > selE ? selS : selE) : selS;

                const isStart = cell.label === minLabel;
                const isEnd = cell.label === maxLabel;
                const inRange = minLabel && maxLabel && cell.label > minLabel && cell.label < maxLabel;

                let bg = "transparent", bc = "transparent", tc = cell.isCurrentMonth ? (hasData ? C.textSec : C.textMute) : C.textDim + "60";
                if (!hasData && !cell.isCurrentMonth) { tc = C.textDim + "20"; }
                if (isStart && isEnd) { bg = `linear-gradient(135deg,${C.blue},${C.purple})`; bc = C.blue; tc = "#fff"; }
                else if (isStart) { bg = C.blue; bc = C.blue; tc = "#fff"; }
                else if (isEnd) { bg = C.purple; bc = C.purple; tc = "#fff"; }
                else if (inRange) { bg = C.blue + "20"; bc = "transparent"; tc = hasData ? "#93c5fd" : C.textMute; }

                return (
                  <div
                    key={ci}
                    onClick={(ev) => { ev.stopPropagation(); if (cell.isCurrentMonth || hasData) calClick(cell); }}
                    style={{
                      padding: "7px 2px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: (hasData || cell.isCurrentMonth) ? "pointer" : "default", border: `1.5px solid ${bc}`,
                      color: tc, background: bg, textAlign: "center",
                      opacity: cell.isCurrentMonth ? 1 : 0.4,
                    }}
                  >
                    {cell.day}
                  </div>
                );
              })}
            </div>

            {/* Hint */}
            <div style={{ color: C.textMute, fontSize: 11, marginTop: 10, minHeight: 16 }}>
              {historyLoading
                ? "⏳ Загружаем данные за выбранный период..."
                : (() => {
                    const s = pendingCalS ?? (calS !== null ? DAYS[calS] : null);
                    const e = pendingCalE ?? (calE !== null ? DAYS[calE] : null);
                    if (!s) return "Кликните на начальную дату";
                    if (!e || e === s) return `Начало: ${s} — выберите конец`;
                    return s < e ? `${s} — ${e}` : `${e} — ${s}`;
                  })()
              }
            </div>

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, gap: 8 }}>
              <button onClick={resetDR} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>Сброс</button>
              <button onClick={applyDR} style={{ background: C.blue, border: "none", color: "#fff", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Применить ✓</button>
            </div>
          </div>
        )}

        <div
          onClick={() => {
            if (DAYS[0] > '01.02' && !historyLoading) {
              // Данные не с начала — подгружаем полную историю
              setPendingCalS('01.02');
              setPendingCalE(DAYS[DAYS.length - 1]);
              loadHistory('2026-02-01');
            } else {
              setDrS(0); setDrE(DAYS.length - 1); setCalS(0); setCalE(DAYS.length - 1);
            }
          }}
          style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 11px", fontSize: 11, color: historyLoading ? C.textMute : C.textSec, cursor: historyLoading ? "default" : "pointer" }}
        >
          {historyLoading ? "⏳ Загрузка..." : "Весь период"}
        </div>
      </div>
      </div>{/* end sticky top area */}

      {/* ═══ CONTENT ═══ */}
      <div style={{ padding: "16px 18px" }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button onClick={async () => {
                const totalRev = sum(FLT.map(r => r._rev_period || 0));
                const totalCost = sum(FLT.map(r => r._cost_period || 0));
                const totalChmd = sum(FLT.map(r => r._chmd_period || 0));
                const prevLen = drE - drS + 1;
                const pS = Math.max(0, drS - prevLen), pE = drS - 1;
                const prevRev = pE >= 0 ? sum(FLT.map(r => sum((r.rev_d || []).slice(pS, pE + 1)))) : 0;
                const prevCost = pE >= 0 ? sum(FLT.map(r => sum((r.cost_d || []).slice(pS, pE + 1)))) : 0;
                const prevChmd = pE >= 0 ? sum(FLT.map(r => sum((r.chmd_d || []).slice(pS, pE + 1)))) : 0;
                const fFull = (v: number) => Math.round(v).toLocaleString('ru-RU') + ' ₽';
                const dPct = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev * 100).toFixed(1) + "%" : "—";
                const kpi = [
                  { label: "Выручка", value: fFull(totalRev), delta: prevRev > 0 ? dPct(totalRev, prevRev) : undefined, good: totalRev >= prevRev },
                  { label: "ЧМД", value: fFull(totalChmd), delta: prevChmd > 0 ? dPct(totalChmd, prevChmd) : undefined, good: totalChmd >= prevChmd },
                  { label: "Рекламные расходы", value: fFull(totalCost), delta: prevCost > 0 ? dPct(totalCost, prevCost) : undefined, good: totalCost <= prevCost },
                  { label: "Маржа (взв.)", value: totalRev > 0 ? (FLT.reduce((s, r) => s + (r.margin_pct ?? 0) * (r._rev_period || 0), 0) / totalRev).toFixed(1) + "%" : "—" },
                  { label: "ДРР", value: totalRev > 0 ? fP(totalCost / totalRev) : "—" },
                  { label: "Кол-во SKU", value: String(FLT.length) },
                ];
                const cmpData = comparison ? [
                  { label: "Выручка", cur: fM(comparison.curRev), prev: fM(comparison.prevRev), delta: dPct(comparison.curRev, comparison.prevRev), good: comparison.curRev >= comparison.prevRev },
                  { label: "Расходы", cur: fM(comparison.curCost), prev: fM(comparison.prevCost), delta: dPct(comparison.curCost, comparison.prevCost), good: comparison.curCost <= comparison.prevCost },
                  { label: "CTR", cur: fP(comparison.curCtr), prev: fP(comparison.prevCtr), delta: comparison.prevCtr != null && comparison.curCtr != null ? ((comparison.curCtr - comparison.prevCtr) * 100).toFixed(2) + "%" : "—", good: (comparison.curCtr ?? 0) >= (comparison.prevCtr ?? 0) },
                  { label: "CR корзина", cur: fP(comparison.curCrCart), prev: fP(comparison.prevCrCart), delta: comparison.prevCrCart != null && comparison.curCrCart != null ? ((comparison.curCrCart - comparison.prevCrCart) * 100).toFixed(2) + "%" : "—", good: (comparison.curCrCart ?? 0) >= (comparison.prevCrCart ?? 0) },
                  { label: "CR заказ", cur: fP(comparison.curCr), prev: fP(comparison.prevCr), delta: comparison.prevCr != null && comparison.curCr != null ? ((comparison.curCr - comparison.prevCr) * 100).toFixed(2) + "%" : "—", good: (comparison.curCr ?? 0) >= (comparison.prevCr ?? 0) },
                  { label: "ДРР", cur: fP(comparison.curDrr), prev: fP(comparison.prevDrr), delta: comparison.prevDrr != null && comparison.curDrr != null ? ((comparison.curDrr - comparison.prevDrr) * 100).toFixed(2) + "%" : "—", good: (comparison.curDrr ?? 0) <= (comparison.prevDrr ?? 0) },
                ] : null;
                const alertFilters: Record<string, (r: ComputedSKU) => boolean> = {
                  oosAd: (r) => r._oosst === "red" && r._cost_period > 0,
                  potential: (r) => r._ctr_period != null && r._cr_period != null && r._ctr_period > 0.03 && r._cr_period < 0.01 && r._oosst !== "red",
                  canBoost: (r) => r.margin_pct != null && r.margin_pct >= 20 && r._drr_period != null && r._drr_period < (r.margin_pct ?? 0) / 200 && r._oosst !== "red",
                  riskyNew: (r) => r.is_new && (r._rev_period == null || r._rev_period < 5000) && r._oosst !== "red",
                  highCpo: (r) => { if (!r._cost_period || !r._rev_period || !r.price || r.price <= 0) return false; const o = r._rev_period / r.price; return o > 0 && r._cost_period / o > r.price * 0.3; },
                };
                const alertValueFn: Record<string, (r: ComputedSKU) => string> = {
                  oosAd: (r) => fR(r._cost_period), potential: (r) => `CTR: ${fP(r._ctr_period)} CR: ${fP(r._cr_period)}`,
                  canBoost: (r) => `ДРР: ${fP(r._drr_period)} Маржа: ${fPv(r.margin_pct)}`, riskyNew: (r) => fR(r._rev_period),
                  highCpo: (r) => { const o = r.price && r.price > 0 && r._rev_period ? r._rev_period / r.price : 0; return o > 0 ? Math.round(r._cost_period / o) + "₽" : "—"; },
                };
                const alertsData = alerts.map((a: any) => {
                  const fn = alertFilters[a.filterFn]; const valFn = alertValueFn[a.filterFn];
                  const matched = fn ? FLT.filter(fn).sort((x, y) => (y._cost_period || 0) - (x._cost_period || 0)).slice(0, 5) : [];
                  return { title: a.title, count: a.count, desc: a.desc, topSkus: matched.map(r => ({ sku: r.sku, name: r.name || '', value: valFn ? valFn(r) : '' })) };
                });
                const catData = catRanking.byRev.slice(0, 15).map(([name, d]: any) => ({ name, rev: fM(d.rev), delta: catRanking.byDyn.find((x: any) => x.name === name)?.delta != null ? ((catRanking.byDyn.find((x: any) => x.name === name)?.delta ?? 0) * 100).toFixed(1) + "%" : "—", cnt: d.cnt }));
                const dynData = catRanking.byDyn.slice(0, 15).map((d: any) => ({ name: d.name, revChange: (d.revChange > 0 ? "+" : "") + fM(Math.abs(d.revChange)), delta: (d.delta > 0 ? "+" : "") + (d.delta * 100).toFixed(1) + "%", rev: fM(d.rev) }));
                const mgrD = mgrData.map(([nm, m]: any) => ({ name: nm, sku: m.cnt, newCount: m.new, rev: fM(m.rev), chmd: fM(m.chmd), margin: m.rev > 0 ? (m.mgWeighted / m.rev).toFixed(1) + "%" : "—", drr: m.rev > 0 ? fP(m.cost / m.rev) : "—", oosR: m.oosR, oosY: m.oosY, drrOver: m.drrOver }));
                const chartDaysL = DAYS.slice(drS, drE + 1);
                const dailyData = chartDaysL.map((d, i) => { const dr = sum(FLT.map(r => r.rev_d?.[drS + i] || 0)); const dc = sum(FLT.map(r => r.cost_d?.[drS + i] || 0)); return { date: d, rev: fFull(dr), cost: fFull(dc), drr: dr > 0 ? fP(dc / dr) : "—" }; });
                await exportPPTX({ period: `${DAYS[drS]} — ${DAYS[drE]}`, skuCount: FLT.length, kpi, comparison: cmpData, alerts: alertsData, categories: catData, dynamics: dynData, managers: mgrD, dailyData });
              }} style={{
                background: `linear-gradient(135deg, ${C.purple}, ${C.blue})`, border: "none", color: "#fff", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 2px 8px rgba(168,85,247,.3)",
              }}>📊 Скачать презентацию (PPTX)</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 12 }}>
              <KPICard icon="💰" label="Выручка (период)" value={fM(sum(FLT.map((r) => r._rev_period || 0)))} color={C.blue} sub="факт за выбранный период" />
              <KPICard icon="📈" label="ЧМД (период)" value={fM(sum(FLT.map((r) => r._chmd_period || 0)))} color={C.teal} sub="сумма дневных ЧМД" />
              <KPICard icon="💸" label="Расходы на рекламу" value={fM(sum(FLT.map((r) => r._cost_period || 0)))} color={C.red} sub="рекламные затраты за период" />
              <KPICard icon="📊" label="Средняя маржа" value={fPv((() => {
                const totalRev = sum(FLT.map(r => r._rev_period || 0));
                if (totalRev <= 0) return avg(FLT.map(r => r.margin_pct));
                const weightedSum = FLT.reduce((s, r) => s + (r.margin_pct ?? 0) * (r._rev_period || 0), 0);
                return weightedSum / totalRev;
              })())} color={C.purple} sub="взвешенная по выручке" />
              <KPICard icon="🎯" label="ДРР (период)" value={fP((() => {
                const totalRev = sum(FLT.map(r => r._rev_period || 0));
                const totalCost = sum(FLT.map(r => r._cost_period || 0));
                return totalRev > 0 ? totalCost / totalRev : null;
              })())} color={C.yellow} sub="затраты / выручка" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
              <KPICard icon="🚨" label="🔴 OOS — Критично" value={FLT.filter((r) => r._oosst === "red").length} color={C.red} sub="запас ≤ 0 дней" clickable onClick={() => goTable({ oos: "red" })} />
              <KPICard icon="⚠️" label="🟡 OOS — Внимание" value={FLT.filter((r) => r._oosst === "yellow").length} color={C.yellow} sub="запас 1–13 дней" clickable onClick={() => goTable({ oos: "yellow" })} />
              <KPICard icon="📉" label="🔴 ДРР > Маржа" value={FLT.filter((r) => r._drrover).length} color={C.red} sub="ДРР превышает маржу%" clickable onClick={() => goTable({ drr: "over" })} />
              <KPICard icon="⭐" label="Новинки" value={FLT.filter((r) => r.is_new).length} color={C.purple} sub="в текущей выборке" clickable onClick={() => goTable({ isNew: true })} />
            </div>

            <Section title="Алерты и рекомендации" icon="🔔">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10, marginBottom: 12 }}>
                {alerts.map((a, i) => <AlertCard key={i} {...a} onClick={() => goAlertTable(a.filterFn)} />)}
              </div>
            </Section>

            <Section title="Сравнение с предыдущим периодом" icon="📊">
              {comparison ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8, marginBottom: 12 }}>
                  <CmpCard label="Выручка" cur={comparison.curRev} prev={comparison.prevRev} fmt={fM} />
                  <CmpCard label="Расходы" cur={comparison.curCost} prev={comparison.prevCost} fmt={fM} invert />
                  <CmpCard label="CTR" cur={comparison.curCtr} prev={comparison.prevCtr} fmt={fP} />
                  <CmpCard label="CR корзина" cur={comparison.curCrCart} prev={comparison.prevCrCart} fmt={fP} />
                  <CmpCard label="CR заказ" cur={comparison.curCr} prev={comparison.prevCr} fmt={fP} />
                  <CmpCard label="ДРР" cur={comparison.curDrr} prev={comparison.prevDrr} fmt={fP} invert />
                </div>
              ) : <div style={{ color: C.textMute, fontSize: 12, textAlign: "center", padding: 12 }}>Недостаточно данных для сравнения</div>}
            </Section>

            <Section title="Графики" icon="📈">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 11 }}>Выручка и расходы по дням</div>
                  <ResponsiveContainer width="100%" height={185}>
                    <ComposedChart data={revDynData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="date" tick={{ fill: C.textMute, fontSize: 9 }} />
                      <YAxis yAxisId="l" tick={{ fill: C.blue, fontSize: 9 }} tickFormatter={fAxis} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fill: C.red, fontSize: 9 }} tickFormatter={fAxis} />
                      <Tooltip cursor={{ fill: "transparent", stroke: "transparent" }} content={<ChartTooltip formatter={(v: number) => fM(v)} />} />
                      <Bar yAxisId="l" dataKey="rev" fill={C.blue + "40"} stroke={C.blue} name="Выручка" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="cost" stroke={C.red} name="Расходы" strokeWidth={2} dot={{ r: 3, fill: C.red }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 11 }}>Воронка конверсий по дням</div>
                  <ResponsiveContainer width="100%" height={185}>
                    <LineChart data={funnelData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="date" tick={{ fill: C.textMute, fontSize: 9 }} />
                      <YAxis tick={{ fill: C.textMute, fontSize: 9 }} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                      <Tooltip cursor={{ fill: "transparent", stroke: "transparent" }} content={<ChartTooltip formatter={(v: number) => fP(v)} />} />
                      <Line type="monotone" dataKey="ctr" stroke={C.blue} name="CTR" strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="cr_cart" stroke={C.yellow} name="CR корзина" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="cr" stroke={C.green} name="CR заказ" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                {/* Margin distribution */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>Маржинальность</div>
                  {[
                    { l: "🔴 Низкая (<15%)", cnt: mrgDist.red, c: C.red },
                    { l: "🟡 Средняя (15–20%)", cnt: mrgDist.yellow, c: C.yellow },
                    { l: "🟢 Хорошая (≥20%)", cnt: mrgDist.green, c: C.green },
                  ].map((it, i) => {
                    const pct = (it.cnt / mrgDist.total * 100).toFixed(0);
                    return (
                      <div key={i} style={{ marginBottom: 9 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 11 }}>
                          <span style={{ color: C.textSec }}>{it.l}</span>
                          <span style={{ color: it.c, fontWeight: 700 }}>{it.cnt}·{pct}%</span>
                        </div>
                        <div style={{ background: C.bg, borderRadius: 5, height: 7 }}>
                          <div style={{ height: "100%", borderRadius: 5, background: it.c, width: `${pct}%`, transition: "width .4s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Adv vs Org */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>Рекламные vs органические</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <ResponsiveContainer width={115} height={115}>
                      <PieChart><Pie data={advOrgPie} dataKey="value" innerRadius={33} outerRadius={55} paddingAngle={2}>{advOrgPie.map((d, i) => <Cell key={i} fill={d.color} />)}</Pie><Tooltip cursor={{ fill: "transparent" }} formatter={(v) => fM(v as number)} /></PieChart>
                    </ResponsiveContainer>
                    <div style={{ flex: 1 }}>
                      {advOrgPie.map((x, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 9, height: 9, borderRadius: 2, background: x.color }} /><span style={{ color: C.textSec, fontSize: 11 }}>{x.name}</span></div>
                          <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, fontWeight: 700 }}>{fM(x.value)}</div><div style={{ color: C.textMute, fontSize: 10 }}>{(x.value / advOrg.total * 100).toFixed(1)}%</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* DRR by manager */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>ДРР факт vs план</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={drrMgrData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="name" tick={{ fill: C.textMute, fontSize: 10 }} />
                      <YAxis tick={{ fill: C.textMute, fontSize: 9 }} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                      <Tooltip cursor={{ fill: "transparent", stroke: "transparent" }} content={<ChartTooltip formatter={(v: number) => fP(v)} />} />
                      <Bar dataKey="fact" fill={C.red + "aa"} name="ДРР факт" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="plan" fill={C.green + "30"} stroke={C.green} name="ДРР план" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Section>

            <Section title="Рейтинг категорий" icon="🏆">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>Категории по выручке</div>
                  <div style={{ maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>
                    {catRanking.byRev.map(([name, d], i) => <CatRankItem key={name} pos={i + 1} name={name} value={d.rev} maxVal={catRanking.byRev[0]?.[1]?.rev || 1} sub={`${d.cnt} SKU`} />)}
                  </div>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>Динамика категорий (по выручке)</div>
                  <div style={{ maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>
                    {catRanking.byDyn.length > 0 ? (() => {
                      const maxChange = Math.max(...catRanking.byDyn.map(x => Math.abs(x.revChange)));
                      return catRanking.byDyn.map((d) => (
                        <CatRankItem
                          key={d.name}
                          pos={d.revChange > 0 ? "▲" : "▼"}
                          name={d.name}
                          value={Math.abs(d.revChange)}
                          maxVal={maxChange || 1}
                          color={d.revChange > 0 ? C.green : C.red}
                          valueFmt={(v) => `${d.revChange > 0 ? "+" : "-"}${fM(v)}`}
                          sub={`${d.delta > 0 ? "+" : ""}${(d.delta * 100).toFixed(1)}%  ·  ${fM(d.rev)}`}
                        />
                      ));
                    })() : <div style={{ color: C.textMute, fontSize: 12 }}>Недостаточно данных для сравнения</div>}
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Тренды метрик по дням" icon="📉">
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14, marginBottom: 12 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={trendsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                    <XAxis dataKey="date" tick={{ fill: C.textMute, fontSize: 9 }} />
                    <YAxis yAxisId="l" tick={{ fill: C.textMute, fontSize: 9 }} tickFormatter={fAxis} />
                    <YAxis yAxisId="r" orientation="right" domain={['auto', 'auto']} tick={{ fill: C.yellow, fontSize: 9 }} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                    <Tooltip cursor={{ fill: "transparent", stroke: "transparent" }} content={<ChartTooltip formatter={(v: number, name: string) => name === "ДРР" ? fP(v) : fM(v)} />} />
                    <Area yAxisId="l" type="monotone" dataKey="rev" fill={C.blue + "15"} stroke={C.blue} name="Выручка" strokeWidth={2.5} dot={{ r: 4 }} />
                    <Line yAxisId="l" type="monotone" dataKey="chmd" stroke={C.green} name="ЧМД" strokeWidth={2} dot={{ r: 3 }} />
                    <Line yAxisId="l" type="monotone" dataKey="cost" stroke={C.red} name="Расходы" strokeWidth={2} dot={{ r: 3 }} />
                    <Line yAxisId="r" type="monotone" dataKey="drr" stroke={C.yellow} name="ДРР" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="По менеджерам" icon="👥">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>Выручка по менеджерам</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <ResponsiveContainer width={125} height={125}>
                      <PieChart><Pie data={mgrPieData} dataKey="value" innerRadius={38} outerRadius={60} paddingAngle={2}>{mgrPieData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip cursor={{ fill: "transparent" }} formatter={(v) => fM(v as number)} /></PieChart>
                    </ResponsiveContainer>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {mgrPieData.map((d: any, i: number) => (
                        <div key={d.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} /><span style={{ color: C.textSec, fontSize: 11 }}>{d.name}</span></div>
                          <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, fontWeight: 700 }}>{fM(d.value)}</div><div style={{ color: C.textMute, fontSize: 10 }}>{(d.value / mgrTotal * 100).toFixed(1)}%</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
                  <div style={{ color: C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 11 }}>Сводка по менеджерам</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}><tr>
                        {["Менеджер", "SKU", "★", "Выручка", "ЧМД", "Маржа", "ДРР", "OOS крит.", "OOS вним.", "ДРР>М"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "7px 6px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {mgrData.map(([nm, m]: any) => {
                          const am = m.rev > 0 ? m.mgWeighted / m.rev : 0;
                          const ad = m.rev > 0 ? m.cost / m.rev : 0;
                          return (
                            <tr key={nm} style={{ borderBottom: `1px solid ${C.cardHover}` }}>
                              <td onClick={() => { setFMgr(nm); goTable({}); }} style={{ padding: "6px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>{nm}</td>
                              <td onClick={() => { setFMgr(nm); goTable({}); }} style={{ padding: "6px", color: C.textSec, cursor: "pointer" }}>{m.cnt}</td>
                              <td onClick={() => { setFMgr(nm); setFNew("new"); goTable({}); }} style={{ padding: "6px", color: C.purple, cursor: "pointer" }}>{m.new}</td>
                              <td onClick={() => { setFMgr(nm); goTable({}); }} style={{ padding: "6px", color: C.blue, fontWeight: 700, cursor: "pointer" }}>{fM(m.rev)}</td>
                              <td onClick={() => { setFMgr(nm); goTable({}); }} style={{ padding: "6px", color: C.teal, cursor: "pointer" }}>{fM(m.chmd)}</td>
                              <td style={{ padding: "6px", color: am < 15 ? C.red : am < 20 ? C.yellow : C.green, fontWeight: 600 }}>{am.toFixed(1)}%</td>
                              <td style={{ padding: "6px", color: ad * 100 > am ? C.red : C.textSec }}>{(ad * 100).toFixed(2)}%</td>
                              <td onClick={() => { setFMgr(nm); goTable({ oos: "red" }); }} style={{ padding: "6px", color: C.red, fontWeight: 700, cursor: "pointer" }}>{m.oosR}</td>
                              <td onClick={() => { setFMgr(nm); goTable({ oos: "yellow" }); }} style={{ padding: "6px", color: C.yellow, fontWeight: 700, cursor: "pointer" }}>{m.oosY}</td>
                              <td onClick={() => { setFMgr(nm); goTable({ drr: "over" }); }} style={{ padding: "6px", color: C.red, fontWeight: 700, cursor: "pointer" }}>{m.drrOver}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Section>
          </div>
        )}

        {/* ── TABLE TAB ── */}
        {tab === "table" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 200px)", background: "#0f1117" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 11, alignItems: "flex-end" }}>
              <FilterSelect label="OOS" value={tFilt.oos} onChange={(v) => { setAlertFilter(null); setTFilt({ ...tFilt, oos: v }); setTblOffset(0); }} options={[{ value: "", label: "Все" }, { value: "red", label: "🔴 Критично" }, { value: "yellow", label: "🟡 Внимание" }, { value: "green", label: "🟢 Норма" }]} />
              <FilterSelect label="ДРР" value={tFilt.drr} onChange={(v) => { setAlertFilter(null); setTFilt({ ...tFilt, drr: v }); setTblOffset(0); }} options={[{ value: "", label: "Все" }, { value: "over", label: "🔴 ДРР>Маржа" }, { value: "ok", label: "🟢 ДРР≤Маржа" }]} />
              <FilterSelect label="Маржа" value={tFilt.mrg} onChange={(v) => { setAlertFilter(null); setTFilt({ ...tFilt, mrg: v }); setTblOffset(0); }} options={[{ value: "", label: "Все" }, { value: "red", label: "🔴 <15%" }, { value: "yellow", label: "🟡 15–20%" }, { value: "green", label: "🟢 ≥20%" }]} />
              <FilterSelect label="Реклама" value={tFilt.adv} onChange={(v) => { setAlertFilter(null); setTFilt({ ...tFilt, adv: v }); setTblOffset(0); }} options={[{ value: "", label: "Все" }, { value: "adv", label: "С рекл." }]} />
              <button onClick={() => { setAlertFilter(null); setTFilt({ oos: "", drr: "", mrg: "", adv: "" }); setTblOffset(0); }}
                style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 12, alignSelf: "flex-end" }}>✕ Сбросить</button>
              <div style={{ marginLeft: "auto", alignSelf: "flex-end", color: C.textMute, fontSize: 12 }}>
                {alertFilter && <span style={{ background: C.blue + "20", border: `1px solid ${C.blue}`, color: C.blue, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, marginRight: 10 }}>🔔 {alertFilter} <span onClick={() => setAlertFilter(null)} style={{ cursor: "pointer", marginLeft: 4 }}>✕</span></span>}
                <b style={{ color: C.text }}>{tblData.length}</b> SKU
              </div>
              <button onClick={() => exportXLSX(tblData, DAYS, drS, drE)} style={{ background: C.cardHover, border: `1px solid ${C.green}`, color: C.green, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600, alignSelf: "flex-end" }}>📥 XLSX</button>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
              <div style={{ overflowX: "auto", overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}><tr>
                    {[
                      { f: "_oosst", l: "OOS" }, { f: "_mrgst", l: "Маржа" }, { f: "sku", l: "SKU" },
                      { l: "★", ns: true }, { l: "Название", ns: true }, { f: "mgr", l: "Менеджер" },
                      { f: "cat", l: "Категория" }, { f: "_rev_period", l: "Выручка" }, { f: "margin_pct", l: "Маржа%" },
                      { f: "_chmd_period", l: "ЧМД" }, { f: "gmroi_calc", l: "GMROI расч." }, { f: "_drr_period", l: "ДРР ф." },
                      { f: "_ctr_period", l: "CTR" }, { f: "_cr_cart_period", l: "CR к." }, { f: "_cr_period", l: "CR з." },
                      { f: "stock_total", l: "Остаток" }, { f: "oos_days", l: "Запас дн." }, { f: "_cpo", l: "CPO" },
                    ].map((col: any) => (
                      <th key={col.l} onClick={col.ns ? undefined : () => { setTblSort((p) => ({ field: col.f, dir: p.field === col.f ? p.dir * -1 : -1 })); setTblOffset(0); }}
                        style={{ textAlign: "left", padding: "7px 6px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", cursor: col.ns ? "default" : "pointer" }}>
                        {col.l}{!col.ns && " ↕"}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {tblPage.map((r) => (
                      <tr key={r.sku} onClick={() => setModalSku(r.sku)} style={{ borderBottom: `1px solid ${C.cardHover}`, cursor: "pointer" }}>
                        <td style={{ padding: "6px" }}><Dot color={statusColor[r._oosst]} /></td>
                        <td style={{ padding: "6px" }}><Dot color={statusColor[r._mrgst]} /></td>
                        <td style={{ padding: "6px", color: C.textMute, fontSize: 11 }}>{r.sku}</td>
                        <td style={{ padding: "6px" }}>{r.is_new ? <TagNew /> : ""}</td>
                        <td style={{ padding: "6px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }} title={r.name}>{r.name}</td>
                        <td style={{ padding: "6px", color: C.textSec, fontSize: 11 }}>{r.mgr}</td>
                        <td style={{ padding: "6px", color: C.textMute, fontSize: 10 }}>{r.cat}</td>
                        <td style={{ padding: "6px", color: C.blue, fontWeight: 700, fontSize: 11 }}>{fR(r._rev_period)}</td>
                        <td style={{ padding: "6px", color: (r.margin_pct ?? 0) < 15 ? C.red : (r.margin_pct ?? 0) < 20 ? C.yellow : C.green, fontWeight: 600, fontSize: 11 }}>{fPv(r.margin_pct)}</td>
                        <td style={{ padding: "6px", color: C.teal, fontSize: 11 }}>{fR(r._chmd_period)}</td>
                        <td style={{ padding: "6px", color: (r.gmroi_calc ?? 0) < 1 ? C.red : (r.gmroi_calc ?? 0) < 2 ? C.yellow : C.green, fontWeight: 600, fontSize: 11 }}>{r.gmroi_calc != null ? r.gmroi_calc.toFixed(2) : "—"}</td>
                        <td style={{ padding: "6px", color: r._drrover ? C.red : C.green, fontWeight: 600, fontSize: 11 }}>{fP(r._drr_period)}</td>
                        <td style={{ padding: "6px", fontSize: 11 }}>{fP(r._ctr_period)}</td>
                        <td style={{ padding: "6px", fontSize: 11 }}>{fP(r._cr_cart_period)}</td>
                        <td style={{ padding: "6px", fontSize: 11 }}>{fP(r._cr_period)}</td>
                        <td style={{ padding: "6px", color: C.textSec, fontSize: 11 }}>{r.stock_total != null ? Math.round(r.stock_total).toLocaleString("ru-RU") : "—"}</td>
                        <td style={{ padding: "6px", color: r.oos_days != null && r.oos_days <= 0 ? C.red : r.oos_days != null && r.oos_days < 14 ? C.yellow : C.textSec, fontWeight: r.oos_days != null && r.oos_days < 14 ? 700 : 400, fontSize: 11 }}>{r.oos_days != null ? r.oos_days + "д" : "—"}</td>
                        <td style={{ padding: "6px", color: r._cpo != null ? (r._cpo > 500 ? C.red : r._cpo > 200 ? C.yellow : C.green) : C.textMute, fontWeight: r._cpo != null ? 700 : 400, fontSize: 11 }}>{r._cpo != null ? Math.round(r._cpo).toLocaleString("ru-RU") + "₽" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ textAlign: "center", padding: 10, color: C.textMute, fontSize: 12 }}>
                {tblData.length > PAGE_SIZE ? <>
                  <span style={{ marginRight: 8 }}>Стр. {tblCurPage}/{tblPages}</span>
                  {tblOffset > 0 && <button onClick={() => setTblOffset(tblOffset - PAGE_SIZE)} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textSec, padding: "4px 11px", borderRadius: 5, cursor: "pointer", marginRight: 5, fontSize: 12 }}>← Пред.</button>}
                  {tblOffset + PAGE_SIZE < tblData.length && <button onClick={() => setTblOffset(tblOffset + PAGE_SIZE)} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textSec, padding: "4px 11px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>След. →</button>}
                </> : `Всего: ${tblData.length} SKU`}
              </div>
            </div>
          </div>
        )}

        {/* ── PRICE TAB ── */}
        {tab === "price" && (
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 11, alignItems: "flex-end" }}>
              <FilterSelect label="Менеджер" value={pfMgr} onChange={setPfMgr} options={[{ value: "", label: "Все" }, ...managers.map((m) => ({ value: m, label: m }))]} />
              <FilterSelect label="Категория" value={pfCat} onChange={setPfCat} options={[{ value: "", label: "Все" }, ...categories.map((c) => ({ value: c, label: c }))]} />
              <FilterSelect label="Δ цены" value={pfDir} onChange={setPfDir} options={[{ value: "", label: "Любое" }, { value: "up", label: "▲ Рост" }, { value: "dn", label: "▼ Сниж." }]} />
              <FilterSelect label="Δ CTR" value={pfCtr} onChange={setPfCtr} options={[{ value: "", label: "Любое" }, { value: "pos", label: "▲ Рост" }, { value: "neg", label: "▼ Падение" }]} />
              <FilterSelect label="Δ CR корзина" value={pfCrCrt} onChange={setPfCrCrt} options={[{ value: "", label: "Любое" }, { value: "pos", label: "▲ Рост" }, { value: "neg", label: "▼ Падение" }]} />
              <FilterSelect label="Δ CR заказ" value={pfCr} onChange={setPfCr} options={[{ value: "", label: "Любое" }, { value: "pos", label: "▲ Рост" }, { value: "neg", label: "▼ Падение" }]} />
              <FilterSelect label="CPO" value={pfCpo} onChange={setPfCpo} options={[{ value: "", label: "Любое" }, { value: "high", label: "> 200₽" }, { value: "low", label: "≤ 200₽" }]} />
              <FilterSelect label="Δ CPM" value={pfCpm} onChange={setPfCpm} options={[{ value: "", label: "Любое" }, { value: "pos", label: "▲ Рост" }, { value: "neg", label: "▼ Падение" }]} />
              <FilterSelect label="Δ CPC" value={pfCpc} onChange={setPfCpc} options={[{ value: "", label: "Любое" }, { value: "pos", label: "▲ Рост" }, { value: "neg", label: "▼ Падение" }]} />
              <button onClick={() => { setPfDir(""); setPfMgr(""); setPfCat(""); setPfCtr(""); setPfCrCrt(""); setPfCr(""); setPfCpo(""); setPfCpm(""); setPfCpc(""); }}
                style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, alignSelf: "flex-end" }}>✕</button>
              <div style={{ marginLeft: "auto", alignSelf: "flex-end", color: C.textMute, fontSize: 11 }}><b style={{ color: C.text }}>{priceRows.length}</b> изм.</div>
              <button onClick={() => exportPriceXLSX(priceRows, DAYS, drS, drE, new Map(FLT.map((r: any) => [r.sku, r])))} style={{ background: C.cardHover, border: `1px solid ${C.green}`, color: C.green, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600, alignSelf: "flex-end" }}>📥 XLSX</button>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
              {priceRows.length === 0 ? <div style={{ textAlign: "center", padding: 30, color: C.textMute }}>Нет изменений цен</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}><tr>
                      {[{ f: "sku", l: "SKU" }, { l: "Название", ns: true }, { f: "mgr", l: "Менеджер" }, { f: "date", l: "Дата" }, { l: "Было", ns: true }, { l: "Стало", ns: true }, { f: "pct", l: "Δ%" }, { l: "Расх. до", ns: true }, { l: "Расх. после", ns: true }, { f: "delta_ctr", l: "Δ CTR" }, { f: "delta_cr_cart", l: "Δ CR корзина" }, { f: "delta_cr", l: "Δ CR заказ" }, { f: "cpo", l: "CPO" }, { f: "delta_cpm", l: "Δ CPM" }, { f: "delta_cpc", l: "Δ CPC" }].map((col: any) => (
                        <th key={col.l} onClick={col.ns ? undefined : () => setPtSort((p) => ({ field: col.f, dir: p.field === col.f ? p.dir * -1 : -1 }))}
                          style={{ textAlign: "left", padding: "7px 6px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", cursor: col.ns ? "default" : "pointer" }}>
                          {col.l}{!col.ns && " ↕"}
                        </th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {priceRows.map((ch: any, i: number) => {
                        const up = ch.pct > 0;
                        return (
                          <tr key={i} onClick={() => setModalSku(ch.sku)} style={{ borderLeft: `3px solid ${up ? C.green : C.red}`, borderBottom: `1px solid ${C.cardHover}`, cursor: "pointer" }}>
                            <td style={{ padding: "6px", color: C.textMute }}>{ch.sku}</td>
                            <td style={{ padding: "6px", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{ch.name?.slice(0, 22)}…</td>
                            <td style={{ padding: "6px", color: C.textSec }}>{ch.mgr}</td>
                            <td style={{ padding: "6px", color: C.textSec }}>{ch.date}</td>
                            <td style={{ padding: "6px", color: C.textMute }}>{ch.old_price ? ch.old_price.toLocaleString("ru-RU") + "₽" : "—"}</td>
                            <td style={{ padding: "6px", fontWeight: 700 }}>{ch.new_price ? Math.round(ch.new_price).toLocaleString("ru-RU") + "₽" : "—"}</td>
                            <td style={{ padding: "6px", color: up ? C.green : C.red, fontWeight: 700 }}>{up ? "▲+" : "▼"}{(ch.pct * 100).toFixed(1)}%</td>
                            <td style={{ padding: "6px", color: C.textMute }}>{ch.cost_before != null ? Math.round(ch.cost_before).toLocaleString("ru-RU") + "₽" : "—"}</td>
                            <td style={{ padding: "6px", color: C.textMute }}>{ch.cost_after != null ? Math.round(ch.cost_after).toLocaleString("ru-RU") + "₽" : "—"}</td>
                            <td style={{ padding: "6px" }}>{dbFn(ch.delta_ctr)}</td>
                            <td style={{ padding: "6px" }}>{dbFn(ch.delta_cr_cart)}</td>
                            <td style={{ padding: "6px" }}>{dbFn(ch.delta_cr)}</td>
                            <td style={{ padding: "6px", color: ch.cpo != null ? (ch.cpo > 500 ? C.red : ch.cpo > 200 ? C.yellow : C.green) : C.textMute, fontWeight: 700 }}>{ch.cpo != null ? Math.round(ch.cpo).toLocaleString("ru-RU") + "₽" : "—"}</td>
                            <td style={{ padding: "6px" }}>{dbFn(ch.delta_cpm)}</td>
                            <td style={{ padding: "6px" }}>{dbFn(ch.delta_cpc)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        {/* ── ANALYTICS TAB ── */}
        {tab === "analytics" && (() => {
          const renderDelta = (d: number | null) => {
            if (d == null) return <span style={{ color: C.textDim }}>—</span>;
            const up = d > 0;
            return <span style={{ color: up ? C.green : C.red, fontWeight: 700 }}>{up ? "+" : ""}{(d * 100).toFixed(1)}%</span>;
          };

          const renderDeltaPP = (d: number | null, invertColor?: boolean) => {
            if (d == null) return <span style={{ color: C.textDim }}>—</span>;
            const up = d > 0;
            const color = invertColor ? (up ? C.red : C.green) : (up ? C.green : C.red);
            return <span style={{ color, fontWeight: 700 }}>{up ? "+" : ""}{(d * 100).toFixed(2)}%</span>;
          };

          // Build flat rows from expanded tree
          const rows: { type: 'cat' | 'pred' | 'sku'; row: any }[] = [];
          for (const cat of filteredAnalytics) {
            rows.push({ type: 'cat', row: cat });
            if (anExpanded.has(cat.key) && cat.children) {
              for (const pred of cat.children) {
                rows.push({ type: 'pred', row: pred });
                if (anExpanded.has(pred.key) && pred.children) {
                  for (const sku of pred.children) {
                    rows.push({ type: 'sku', row: sku });
                  }
                }
              }
            }
          }

          const thStyle: any = { textAlign: "right", padding: "8px 4px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", cursor: "pointer" };

          return (
          <div>
            {/* Filters */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 11, alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600, textTransform: "uppercase", paddingLeft: 2 }}>🔍 Поиск</div>
                <input value={anSearch} onChange={(e) => setAnSearch(e.target.value)} placeholder="Категория, SKU, название..."
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", color: C.text, fontSize: 12, outline: "none", width: 180 }} />
              </div>
              <FilterSelect label="Менеджер" value={anMgr} onChange={setAnMgr} options={[{ value: "", label: "Все" }, ...managers.map((m) => ({ value: m, label: m }))]} />
              <FilterSelect label="Δ Выручка" value={anRevDir} onChange={setAnRevDir} options={[{ value: "", label: "Любое" }, { value: "up", label: "▲ Рост" }, { value: "dn", label: "▼ Падение" }]} />
              <FilterSelect label="Δ ЧМД" value={anChmdDir} onChange={setAnChmdDir} options={[{ value: "", label: "Любое" }, { value: "up", label: "▲ Рост" }, { value: "dn", label: "▼ Падение" }]} />
              <FilterSelect label="Δ Маржа" value={anMrgDir} onChange={setAnMrgDir} options={[{ value: "", label: "Любое" }, { value: "up", label: "▲ Рост" }, { value: "dn", label: "▼ Падение" }]} />
              <FilterSelect label="Δ ДРР" value={anDrrDir} onChange={setAnDrrDir} options={[{ value: "", label: "Любое" }, { value: "up", label: "▲ Рост" }, { value: "dn", label: "▼ Падение" }]} />
              <FilterSelect label="Мин. выручка" value={anMinRev} onChange={setAnMinRev} options={[{ value: "", label: "Все" }, { value: "100k", label: "> 100K" }, { value: "500k", label: "> 500K" }, { value: "1m", label: "> 1M" }]} />
              <button onClick={() => { setAnSearch(""); setAnMgr(""); setAnRevDir(""); setAnChmdDir(""); setAnMrgDir(""); setAnDrrDir(""); setAnMinRev(""); setAnExpanded(new Set()); }}
                style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 12, alignSelf: "flex-end" }}>✕</button>
              <div style={{ marginLeft: "auto", alignSelf: "flex-end", color: C.textMute, fontSize: 12 }}>
                <b style={{ color: C.text }}>{filteredAnalytics.length}</b> категорий
              </div>
              <button onClick={() => exportAnalyticsXLSX(filteredAnalytics, DAYS, drS, drE, anExpanded)} style={{ background: C.cardHover, border: `1px solid ${C.green}`, color: C.green, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600, alignSelf: "flex-end" }}>📥 XLSX</button>
            </div>

            {/* Table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
              <div style={{ overflowX: "auto", overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: "8px 4px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, minWidth: 140 }}>Категория</th>
                      <th style={{ textAlign: "left", padding: "8px 4px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, minWidth: 130 }}>Предмет</th>
                      <th style={{ textAlign: "left", padding: "8px 4px", color: C.textMute, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, minWidth: 160 }}>SKU</th>
                      {[
                        { f: "rev", l: "Выручка" }, { f: "revDelta", l: "Δ выр." },
                        { f: "chmd", l: "ЧМД" }, { f: "chmdDelta", l: "Δ ЧМД" },
                        { f: "margin", l: "Маржа" }, { f: "marginDelta", l: "Δ маржа" },
                        { f: "drr", l: "ДРР" }, { f: "drrDelta", l: "Δ ДРР" },
                        { f: "cost", l: "Расходы" }, { f: "costDelta", l: "Δ расх." },
                        { f: "stockTotal", l: "Остаток" },
                        { f: "skuCount", l: "SKU" },
                      ].map(col => (
                        <th key={col.f} onClick={() => setAnSort(p => ({ field: col.f, dir: p.field === col.f ? p.dir * -1 : -1 }))}
                          style={thStyle}>{col.l} ↕</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ type, row }) => {
                      const m = row.rev > 0 ? row.marginWeighted / row.rev : null;
                      const mPrev = row.revPrev > 0 ? row.marginWeightedPrev / row.revPrev : null;
                      const mDelta = m != null && mPrev != null ? m - mPrev : null;
                      const drrDelta = row.drr != null && row.drrPrev != null ? row.drr - row.drrPrev : null;

                      const isCat = type === 'cat';
                      const isPred = type === 'pred';
                      const isSku = type === 'sku';
                      const expanded = anExpanded.has(row.key);
                      const hasChildren = row.children && row.children.length > 0;

                      const bgColor = isCat ? "#111827" : isPred ? "#0d1219" : "transparent";
                      const borderLeft = isCat ? `3px solid ${C.blue}` : isPred ? `3px solid ${C.purple}` : `3px solid transparent`;

                      return (
                        <tr key={row.key}
                          style={{ borderBottom: `1px solid ${C.cardHover}`, background: bgColor, borderLeft, cursor: hasChildren ? "pointer" : isSku ? "pointer" : "default" }}
                          onClick={() => { if (hasChildren) toggleExpand(row.key); else if (row.skuData) setModalSku(row.skuData.sku); }}>
                          <td style={{ padding: "7px 6px", fontWeight: 700, fontSize: 11, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                            {isCat ? <><span style={{ color: C.textDim, fontSize: 10, marginRight: 4 }}>{expanded ? "▼" : "►"}</span>{row.name}</> : ""}
                          </td>
                          <td style={{ padding: "7px 6px", fontWeight: 600, fontSize: 11, color: C.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>
                            {isPred ? <><span style={{ color: C.textDim, fontSize: 10, marginRight: 4 }}>{expanded ? "▼" : "►"}</span>{row.name}</> : ""}
                          </td>
                          <td style={{ padding: "7px 6px", fontSize: 10, color: C.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
                            {isSku ? row.name : ""}
                          </td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: C.blue, fontWeight: 700 }}>{fM(row.rev)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right" }}>{renderDelta(row.revDelta)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: C.teal }}>{fM(row.chmd)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right" }}>{renderDelta(row.chmdDelta)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: m != null ? (m < 15 ? C.red : m < 20 ? C.yellow : C.green) : C.textMute }}>{m != null ? m.toFixed(1) + "%" : "—"}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right" }}>{mDelta != null ? <span style={{ color: mDelta > 0 ? C.green : C.red, fontWeight: 700 }}>{mDelta > 0 ? "+" : ""}{mDelta.toFixed(1)}%</span> : <span style={{ color: C.textDim }}>—</span>}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: row.drr != null ? (m != null && row.drr > m / 100 ? C.red : C.textSec) : C.textMute }}>{row.drr != null ? fP(row.drr) : "—"}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right" }}>{renderDeltaPP(drrDelta, true)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: C.textSec }}>{fM(row.cost)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right" }}>{renderDelta(row.costDelta)}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: C.textSec }}>{Math.round(row.stockTotal).toLocaleString("ru-RU")}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", color: C.textMute }}>{row.skuCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredAnalytics.length === 0 && (
                <div style={{ textAlign: "center", padding: 30, color: C.textMute }}>Нет данных по заданным фильтрам</div>
              )}
            </div>
          </div>
          );
        })()}

        {/* ── NICHES TAB ── */}
        {tab === "niches" && (() => {
          if (!nichesLoaded && !nichesLoading) {
            setNichesLoading(true);
            fetch("/niches.json").then(r => r.json()).then(d => { setNichesData(d); setNichesLoaded(true); setNichesLoading(false); }).catch(() => setNichesLoading(false));
          }
          if (nichesLoading) return <div style={{ textAlign: "center", padding: 40, color: C.textMute }}>Загрузка...</div>;
          if (!nichesData.length) return <div style={{ textAlign: "center", padding: 40, color: C.textMute }}>Нет данных</div>;

          const MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
          const dostColor: Record<string, string> = { DEFICIT: C.red, BALANCE: C.yellow, EXCESS: C.green };
          const dostLabel: Record<string, string> = { DEFICIT: 'ДЕФИЦИТ', BALANCE: 'БАЛАНС', EXCESS: 'ИЗБЫТОК' };

          const enriched = nichesData.map((n: any) => {
            const skus = skuByPred.get(n.pred) ?? [];
            return { ...n, _skus: skus, _skuCount: skus.length, _liveRev: skus.reduce((s: number, r: ComputedSKU) => s + (r._rev_period || 0), 0) };
          });

          const q = nSearch.toLowerCase();
          const filtered = enriched.filter((n: any) => {
            if (q && !n.pred.toLowerCase().includes(q) && !n.cat.toLowerCase().includes(q) && !(n.top_phrase || '').toLowerCase().includes(q) && !n._skus.some((r: ComputedSKU) => String(r.sku).includes(q) || (r.name || '').toLowerCase().includes(q))) return false;
            if (nCat && n.cat !== nCat) return false;
            if (nSeason === "seasonal" && n.seasonality !== "Сезонный") return false;
            if (nSeason === "nonseasonal" && n.seasonality === "Сезонный") return false;
            if (nSeasonStart && n.season_start !== nSeasonStart) return false;
            if (nTopMonth && n.top_month !== nTopMonth) return false;
            return true;
          }).sort((a: any, b: any) => {
            const gv = (x: any) => { const f = nSort.field; return f === 'score' ? x.score : f === 'attr' ? x.attr : f === '_liveRev' ? x._liveRev : f === 'seasonality' ? (x.seasonality === 'Сезонный' ? 1 : 0) : x.score; };
            return nSort.dir * (gv(a) - gv(b));
          });

          const nicheCats = [...new Set(enriched.map((n: any) => n.cat))].sort();
          const allStarts = [...new Set(enriched.map((n: any) => n.season_start).filter(Boolean))];
          const allPeaks = [...new Set(enriched.map((n: any) => n.top_month).filter(Boolean))];
          const highP = filtered.filter((n: any) => n.score >= 65).length;
          const midP = filtered.filter((n: any) => n.score >= 50 && n.score < 65).length;

          const MiniSeason = ({ months }: { months: number[] }) => {
            if (!months || months.length !== 12) return <span style={{ color: C.textDim }}>—</span>;
            const maxM = Math.max(...months);
            const tops = new Set(months.map((m, i) => ({ m, i })).sort((a, b) => b.m - a.m).slice(0, 3).map(x => x.i));
            return (
              <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 36, justifyContent: "center" }}>
                {months.map((m, i) => {
                  const isPeak = tops.has(i);
                  const barH = maxM > 0 ? Math.max(4, (m / maxM) * 32) : 4;
                  return (
                    <div key={i} className="mini-bar" title={`${MONTHS_FULL[i]}: ${m}%`}
                      style={{ width: 10, height: barH, background: isPeak ? C.purple : C.blue + "55", borderRadius: 2, cursor: "default", transition: "transform .15s, filter .15s" }} />
                  );
                })}
              </div>
            );
          };

          const colSort = (field: string) => setNSort(p => ({ field, dir: p.field === field ? p.dir * -1 : -1 }));
          const si = (field: string) => nSort.field === field ? (nSort.dir === -1 ? " ▼" : " ▲") : " ↕";
          const ths = (lbl: string, field?: string): any => ({ textAlign: "center", padding: "10px 4px", color: C.textMute, fontSize: 11, fontWeight: 700, borderBottom: `1px solid ${C.border}`, cursor: field ? "pointer" : "default", whiteSpace: "nowrap" });

          return (
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600, textTransform: "uppercase", paddingLeft: 2 }}>🔍 Поиск</div>
                <input value={nSearch} onChange={(e) => setNSearch(e.target.value)} placeholder="Ниша, SKU, название, категория..."
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", color: C.text, fontSize: 12, outline: "none", width: 200 }} />
              </div>
              <FilterSelect label="Сезонность" value={nSeason} onChange={setNSeason} options={[{ value: "", label: "Все" }, { value: "seasonal", label: "Сезонный" }, { value: "nonseasonal", label: "Круглый год" }]} />
              <FilterSelect label="Категория" value={nCat} onChange={setNCat} options={[{ value: "", label: "Все категории" }, ...nicheCats.map((c: string) => ({ value: c, label: c }))]} />
              <FilterSelect label="Старт сезона" value={nSeasonStart} onChange={setNSeasonStart} options={[{ value: "", label: "Все" }, ...allStarts.map((m: string) => ({ value: m, label: m }))]} />
              <FilterSelect label="Пик сезона" value={nTopMonth} onChange={setNTopMonth} options={[{ value: "", label: "Все" }, ...allPeaks.map((m: string) => ({ value: m, label: m }))]} />
              <button onClick={() => { setNSearch(""); setNCat(""); setNSeason(""); setNSeasonStart(""); setNTopMonth(""); setNExpanded(new Set()); }}
                style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 12, alignSelf: "flex-end" }}>✕</button>
              <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignSelf: "flex-end", fontSize: 12 }}>
                <span style={{ color: C.green }}>● Высокий: <b>{highP}</b></span>
                <span style={{ color: C.yellow }}>● Средний: <b>{midP}</b></span>
                <span style={{ color: C.textMute }}>{filtered.length} ниш</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: C.textMute, fontSize: 11, fontWeight: 600 }}>СОРТИРОВКА:</span>
              {[{ f: "score", l: "🎯 Рейтинг" }, { f: "attr", l: "⭐ Привлекательность" }, { f: "_liveRev", l: "💰 Выручка" }].map(s => (
                <button key={s.f} className="sort-btn" onClick={() => colSort(s.f)}
                  style={{ background: nSort.field === s.f ? C.blue + "25" : "transparent", border: `1px solid ${nSort.field === s.f ? C.blue : C.border}`,
                    color: nSort.field === s.f ? C.blue : C.textMute, borderRadius: 16, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                  {s.l} {nSort.field === s.f ? (nSort.dir === -1 ? "↓" : "↑") : ""}
                </button>
              ))}
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "20%" }} /><col style={{ width: "7%" }} /><col style={{ width: "6%" }} />
                  <col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "18%" }} />
                  <col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "10%" }} />
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}><tr>
                  <th style={{ ...ths(""), textAlign: "left" }}>Ниша / Категория</th>
                  <th onClick={() => colSort("score")} style={ths("", "score")}>Рейтинг{si("score")}</th>
                  <th onClick={() => colSort("attr")} style={ths("", "attr")}>Привл.{si("attr")}</th>
                  <th onClick={() => colSort("_liveRev")} style={{ ...ths("", "_liveRev"), textAlign: "left" }}>Выручка{si("_liveRev")}</th>
                  <th onClick={() => colSort("seasonality")} style={ths("", "seasonality")}>Сезонность{si("seasonality")}</th>
                  <th style={ths("")}>Сезон (по месяцам)</th>
                  <th style={ths("")}>Старт</th>
                  <th style={ths("")}>Пик</th>
                  <th style={ths("")}>Доступность</th>
                </tr></thead>
                <tbody>
                  {filtered.map((n: any) => {
                    const exp = nExpanded.has(n.pred);
                    const sc = n.score >= 65 ? C.green : n.score >= 50 ? C.yellow : C.textMute;
                    const rows: React.ReactNode[] = [];

                    rows.push(
                      <tr key={n.pred} onClick={() => setNExpanded(prev => { const s = new Set(prev); s.has(n.pred) ? s.delete(n.pred) : s.add(n.pred); return s; })}
                        style={{ borderBottom: `1px solid ${C.cardHover}`, cursor: "pointer", borderLeft: `3px solid ${sc}`, background: exp ? "#0d1520" : "transparent" }}>
                        <td style={{ padding: "11px 6px" }}>
                          <span style={{ color: C.textDim, fontSize: 11, marginRight: 5 }}>{exp ? "▼" : "►"}</span>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{n.pred}</span>
                          <div style={{ color: C.textMute, fontSize: 11, marginTop: 2, paddingLeft: 18 }}>{n.cat}</div>
                        </td>
                        <td style={{ textAlign: "center" }}><span style={{ background: sc + "20", color: sc, padding: "3px 10px", borderRadius: 10, fontWeight: 800, fontSize: 14 }}>{n.score}</span></td>
                        <td style={{ textAlign: "center", color: C.textSec, fontWeight: 700, fontSize: 14 }}>{n.attr}</td>
                        <td style={{ color: n._liveRev > 0 ? C.blue : C.textDim, fontWeight: 700, fontSize: 13 }}>{n._liveRev > 0 ? fM(n._liveRev) : "—"}</td>
                        <td style={{ textAlign: "center" }}>
                          {n.seasonality === "Сезонный" ? <span style={{ background: C.red + "20", color: C.red, padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 700 }}>🟧 Сезонный</span>
                            : <span style={{ background: C.green + "20", color: C.green, padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 700 }}>🟢 Круглый год</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "0 6px" }}><MiniSeason months={n.months} /></td>
                        <td style={{ textAlign: "center", color: C.textSec, fontSize: 12 }}>{n.season_start || "—"}</td>
                        <td style={{ textAlign: "center", color: C.textSec, fontSize: 12 }}>{n.top_month || "—"}</td>
                        <td style={{ textAlign: "center" }}><span style={{ color: dostColor[n.dostupnost] || C.textMute, fontWeight: 700, fontSize: 11 }}>▲ {dostLabel[n.dostupnost] || "—"}</span></td>
                      </tr>
                    );

                    if (exp) {
                      rows.push(
                        <tr key={`${n.pred}-info`} style={{ background: "#0a0e15", borderBottom: `1px solid ${C.border}` }}>
                          <td colSpan={9} style={{ padding: "10px 14px" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><tbody><tr>
                              {[
                                { l: "ВЫРУЧКА 2025", v: fM(n.our_rev), c: C.blue },
                                { l: "ДОЛЯ РЫНКА", v: n.market_share + "%", c: C.text },
                                { l: "ОБЪЁМ РЫНКА 2025", v: fM(n.market_rev), c: C.text },
                                { l: "СР. ОБОРАЧИВ.", v: n.turnover + " дн.", c: C.text },
                                { l: "ОБЪЁМ ЗАПРОСОВ", v: n.search_vol ? n.search_vol.toLocaleString("ru-RU") : "—", c: C.text },
                                { l: "ТОП-ФРАЗА / КОНВЕРСИЯ", v: `${n.top_phrase || "—"} / ${n.search_conv}%`, c: C.purple },
                              ].map((item, ii) => (
                                <td key={ii} style={{ padding: "8px 10px", verticalAlign: "top" }}>
                                  <div style={{ color: C.textMute, fontSize: 9, marginBottom: 3, fontWeight: 700 }}>{item.l}</div>
                                  <div style={{ fontSize: 15, fontWeight: 800, color: item.c }}>{item.v}</div>
                                </td>
                              ))}
                            </tr></tbody></table>
                          </td>
                        </tr>
                      );

                      if (n._skus.length > 0) {
                        rows.push(
                          <tr key={`${n.pred}-skus`} style={{ background: "#080c14" }}>
                            <td colSpan={9} style={{ padding: "4px 14px 10px" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                                <colgroup>
                                  <col style={{ width: "9%" }} /><col style={{ width: "27%" }} /><col style={{ width: "9%" }} />
                                  <col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "11%" }} />
                                  <col style={{ width: "10%" }} /><col style={{ width: "12%" }} />
                                </colgroup>
                                <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#1a1f2e" }}><tr>
                                  {["SKU", "Название", "Менеджер", "Выручка", "Остаток шт.", "Продажи/день", "Запас дн.", "Запас расч."].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "6px 6px", color: C.textMute, fontSize: 10, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {(n._skus as ComputedSKU[]).sort((a, b) => (b._rev_period || 0) - (a._rev_period || 0)).map((r: ComputedSKU) => (
                                    <tr key={r.sku} onClick={() => setModalSku(r.sku)} style={{ cursor: "pointer", borderBottom: `1px solid ${C.cardHover}` }}>
                                      <td style={{ padding: "6px", color: C.textMute }}>{r.sku}</td>
                                      <td style={{ padding: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}{r.is_new ? " ⭐" : ""}</td>
                                      <td style={{ padding: "6px", color: C.textSec }}>{r.mgr}</td>
                                      <td style={{ padding: "6px", color: C.blue, fontWeight: 700 }}>{fM(r._rev_period)}</td>
                                      <td style={{ padding: "6px", color: C.textSec }}>{r.stock_total != null ? Math.round(r.stock_total).toLocaleString("ru-RU") : "—"}</td>
                                      <td style={{ padding: "6px", color: C.textSec }}>{r._sales_per_day != null ? r._sales_per_day.toFixed(1) : "—"}</td>
                                      <td style={{ padding: "6px", color: r.oos_days != null && r.oos_days <= 0 ? C.red : r.oos_days != null && r.oos_days < 14 ? C.yellow : C.green }}>{r.oos_days != null ? r.oos_days + " д." : "—"}</td>
                                      <td style={{ padding: "6px", color: r.oos_days_calc != null && r.oos_days_calc <= 0 ? C.red : r.oos_days_calc != null && r.oos_days_calc < 14 ? C.yellow : C.green }}>{r.oos_days_calc != null ? r.oos_days_calc + " д." : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        );
                      } else {
                        rows.push(<tr key={`${n.pred}-no`} style={{ background: "#080c14" }}><td colSpan={9} style={{ padding: "8px 16px", color: C.textMute }}>Нет SKU в текущих данных</td></tr>);
                      }
                      rows.push(<tr key={`${n.pred}-sep`}><td colSpan={9} style={{ height: 2, background: C.blue + "15" }}></td></tr>);
                    }
                    return rows;
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.textMute }}>Нет ниш по фильтрам</div>}
            </div>
          </div>
          );
        })()}
      </div>

        {tab === "orders" && (
          <div style={{ padding: "0 0 18px" }}>
            <OrderTab />
          </div>
        )}

        {tab === "update" && (
          <div style={{ padding: "18px" }}>
            <UpdateTab />
          </div>
        )}

      {/* SKU MODAL */}
      {modalSku && modalData && <SKUModal sku={modalSku} data={modalData} DAYS={DAYS} drS={drS} drE={drE} onClose={() => setModalSku(null)} />}
    </div>
  );
}
