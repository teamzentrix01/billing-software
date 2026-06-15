'use client';

import { useEffect, useState } from 'react';
import { formatIndianDateTime } from '@/lib/dateUtils';

// ─── Formatters ────────────────────────────────────────────────────────────
const fmt = (v) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  }).format(Number(v) || 0);

const fmtDate = (v) => {
  return formatIndianDateTime(v, '—');
};

const n = (v) => Number(v) || 0;

// ─── Main component ────────────────────────────────────────────────────────
export default function InvoiceClientView({ data, invoiceURL }) {
  const [qrSrc, setQrSrc] = useState('');
  const { bill, items, payments } = data;

  // Generate QR once, client-side only
  useEffect(() => {
    if (!invoiceURL) return;
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(invoiceURL, {
          width: 160, margin: 1, errorCorrectionLevel: 'M',
          color: { dark: '#111827', light: '#ffffff' },
        })
      )
      .then(setQrSrc)
      .catch(() => {}); // non-critical
  }, [invoiceURL]);

  const taxTotal    = n(bill.tax_total);
  const hasDiscount = n(bill.discount_total) > 0;
  const hasTax      = taxTotal > 0;
  const hasRoundOff = n(bill.round_off) !== 0;
  const storeName   = bill.store_name || 'Buyzaar Sync Store';
  const taxRows = Object.values((items || []).reduce((acc, item) => {
    const amount = n(item.tax_amount);
    if (amount <= 0) return acc;
    const type = String(item.tax_type || item.tax_name || 'GST').toUpperCase().includes('IGST')
      ? 'IGST'
      : String(item.tax_type || item.tax_name || 'GST').toUpperCase().includes('CGST')
        ? 'CGST'
        : String(item.tax_type || item.tax_name || 'GST').toUpperCase().includes('SGST')
          ? 'SGST'
          : 'GST';
    const rate = n(item.tax_rate);
    const includeTax = Boolean(item.include_tax);
    const key = `${type}-${rate}-${includeTax ? 'inc' : 'ex'}`;
    acc[key] ||= { type, rate, includeTax, taxable: 0, amount: 0 };
    acc[key].taxable += n(item.taxable_amount) || Math.max(0, n(item.line_total) - amount);
    acc[key].amount += amount;
    return acc;
  }, {}));

  // Build address string
  const addressParts = [
    bill.store_address,
    bill.store_city,
    bill.store_state,
    bill.store_pincode ? `- ${bill.store_pincode}` : null,
  ].filter(Boolean);

  return (
    <>
      {/* ── Print-only styles ───────────────────────────────────────────── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body       { background: #fff !important; -webkit-print-color-adjust: exact; }
          .inv-card  { box-shadow: none !important; border-radius: 0 !important; }
        }
        @page { margin: 12mm; }
      `}</style>

      <div className="min-h-screen bg-slate-100 py-6 px-3 sm:px-4">

        {/* ── Action bar (hidden on print) ──────────────────────────────── */}
        <div className="no-print max-w-2xl mx-auto mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm"
          >
            🖨️ Print / Save as PDF
          </button>
          <span className="text-xs text-slate-400 hidden sm:inline">
            (In the print dialog, choose <strong>Save as PDF</strong> to download)
          </span>
        </div>

        {/* ── Invoice card ──────────────────────────────────────────────── */}
        <div className="inv-card max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">

          {/* Top accent */}
          <div className="h-1.5 bg-gradient-to-r from-blue-600 via-blue-500 to-green-500" />

          <div className="p-6 sm:p-8">

            {/* ── Store header ──────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="min-w-0">
                <h1 className="text-[22px] font-black text-slate-900 leading-tight">
                  {storeName}
                </h1>
                {addressParts.length > 0 && (
                  <p className="text-[12.5px] text-slate-500 mt-0.5">
                    {addressParts.join(', ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {bill.store_phone && (
                    <p className="text-[12px] text-slate-500">📞 {bill.store_phone}</p>
                  )}
                  {bill.store_email && (
                    <p className="text-[12px] text-slate-500">✉️ {bill.store_email}</p>
                  )}
                </div>
                {bill.store_gstin && (
                  <p className="text-[11px] text-slate-500 font-mono bg-slate-50 border border-slate-200 inline-block px-2 py-0.5 rounded mt-1.5">
                    GSTIN: {bill.store_gstin}
                  </p>
                )}
              </div>

              {/* Status badge */}
              <div className="text-right shrink-0">
                <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 font-bold text-[12px] px-3 py-1.5 rounded-xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  PAID
                </span>
                <p className="text-[10px] font-bold tracking-widest text-slate-400 mt-1.5 uppercase">
                  Tax Invoice
                </p>
              </div>
            </div>

            <div className="border-t border-slate-100 mb-5" />

            {/* ── Bill + Customer ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Invoice details */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Invoice Details
                </p>
                <div>
                  <p className="text-[11px] text-slate-400 font-semibold">Invoice No.</p>
                  <p className="font-black text-slate-900">{bill.bill_number}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 font-semibold">Date &amp; Time</p>
                  <p className="font-semibold text-slate-800 text-[12.5px]">
                    {fmtDate(bill.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 font-semibold">Payment Mode</p>
                  <p className="font-semibold text-slate-800 text-[12.5px] capitalize">
                    {bill.payment_mode || '—'}
                  </p>
                </div>
              </div>

              {/* Customer details */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Bill To
                </p>
                <div>
                  <p className="text-[11px] text-slate-400 font-semibold">Customer</p>
                  <p className="font-black text-slate-900">
                    {bill.customer_name || 'Walk-in Customer'}
                  </p>
                </div>
                {bill.customer_mobile && (
                  <div>
                    <p className="text-[11px] text-slate-400 font-semibold">Mobile</p>
                    <p className="font-semibold text-slate-800">+91 {bill.customer_mobile}</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Items table ───────────────────────────────────────────── */}
            <div className="mb-6 rounded-xl overflow-hidden border border-slate-200">
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      #
                    </th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Item
                    </th>
                    <th className="text-center px-2 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Qty
                    </th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Rate
                    </th>
                    <th className="text-right px-2 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide hidden sm:table-cell">
                      Tax
                    </th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2.5 text-slate-400 text-[11px]">{idx + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-slate-900">{item.product_name}</p>
                        {item.sku && (
                          <p className="text-[10px] text-slate-400">{item.sku}</p>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center text-slate-700 font-semibold">
                        {n(item.qty)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700">
                        {fmt(item.selling_price)}
                      </td>
                      <td className="px-2 py-2.5 text-right text-slate-500 text-[11px] hidden sm:table-cell">
                        {n(item.tax_rate) > 0 ? `${n(item.tax_rate)}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                        {fmt(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Totals ────────────────────────────────────────────────── */}
            <div className="flex justify-end mb-6">
              <div className="w-64 space-y-1.5 text-[13px]">
                <Row label="Subtotal" value={fmt(bill.subtotal)} />
                {hasDiscount && (
                  <Row label="Discount" value={`-${fmt(bill.discount_total)}`} valueClass="text-red-600" />
                )}
                {hasTax && taxRows.length > 0 && taxRows.map((row) => (
                  <Row
                    key={`${row.type}-${row.rate}-${row.includeTax ? 'inc' : 'ex'}`}
                    label={`${row.type}${row.rate ? ` ${row.rate}%` : ''}${row.includeTax ? ' (included)' : ''}`}
                    value={fmt(row.amount)}
                    subtle
                  />
                ))}
                {hasTax && taxRows.length === 0 && (
                  <Row label="GST" value={fmt(taxTotal)} subtle />
                )}
                {hasRoundOff && (
                  <Row label="Round Off" value={fmt(bill.round_off)} subtle />
                )}
                <div className="border-t border-slate-200 pt-2 flex justify-between items-baseline">
                  <span className="font-black text-slate-900 text-base">Total</span>
                  <span className="font-black text-blue-600 text-xl">
                    {fmt(bill.grand_total)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Payments ──────────────────────────────────────────────── */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 mb-6">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Payment Received
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {payments.length > 0
                  ? payments.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-[13px]">
                        <span className="capitalize font-semibold text-slate-700">{p.method}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-bold text-slate-900">{fmt(p.amount)}</span>
                        {p.reference_no && (
                          <span className="text-[11px] text-slate-400">
                            Ref: {p.reference_no}
                          </span>
                        )}
                      </div>
                    ))
                  : (
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="capitalize font-semibold text-slate-700">
                        {bill.payment_mode}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-bold text-slate-900">{fmt(bill.grand_total)}</span>
                    </div>
                  )}
              </div>
            </div>

            {/* ── QR + footer ───────────────────────────────────────────── */}
            <div className="border-t border-slate-100 pt-5 flex items-end justify-between gap-4">
              {/* QR code */}
              <div className="text-center">
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt="Invoice QR"
                    className="w-24 h-24 rounded-lg border border-slate-200"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-lg bg-slate-100 animate-pulse" />
                )}
                <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                  SCAN TO VERIFY
                </p>
              </div>

              {/* Footer text */}
              <div className="text-right">
                <p className="text-[11px] text-slate-400">
                  This is a computer-generated invoice.
                </p>
                <p className="text-[11px] text-slate-400">No signature required.</p>
                <p className="text-[12px] font-bold text-slate-600 mt-1.5">
                  Thank you for your purchase! 🙏
                </p>
              </div>
            </div>

          </div>

          {/* Bottom accent */}
          <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-blue-500 to-blue-600" />
        </div>

        {/* ── Invoice URL hint (hidden on print) ────────────────────────── */}
        <p className="no-print max-w-2xl mx-auto mt-3 text-center text-[11px] text-slate-400 break-all">
          {invoiceURL}
        </p>
      </div>
    </>
  );
}

// ─── Tiny helper for total rows ────────────────────────────────────────────
function Row({ label, value, valueClass = 'text-slate-800', subtle = false }) {
  return (
    <div className={`flex justify-between ${subtle ? 'text-slate-500' : 'text-slate-700'}`}>
      <span>{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
