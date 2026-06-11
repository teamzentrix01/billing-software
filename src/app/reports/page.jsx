'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';

const PINNED = [
  {
    label: 'Orders list',
    subtitle: 'Today',
    value: 'Loading...',
    change: null,
    barColor: 'bg-blue-400',
    href: '/reports/orders/list-of-orders',
  },
  {
    label: 'Daily Sales (DSR)',
    subtitle: 'Today',
    value: '₹0',
    change: null,
    barColor: 'bg-green-400',
    href: '/reports/sales/daily-sales',
  },
  {
    label: 'Net sales',
    subtitle: 'Today, after tax & discount',
    value: '₹0',
    change: null,
    barColor: 'bg-blue-300',
    href: '/reports/net-sales',
  },
  {
    label: 'Stock level',
    subtitle: 'Now',
    value: 'Loading...',
    badge: '',
    extra: '',
    barColor: 'bg-blue-200',
    href: '/reports/inventory/stock-level',
  },
];

// icon key → tabler icon class + colors
const ICON = {
  cart:    { icon: 'ti-shopping-cart', bg: 'bg-blue-50',   color: 'text-blue-400' },
  trend:   { icon: 'ti-trending-up',   bg: 'bg-orange-50', color: 'text-orange-400' },
  doc:     { icon: 'ti-file-text',     bg: 'bg-purple-50', color: 'text-purple-400' },
  box:     { icon: 'ti-box',           bg: 'bg-green-50',  color: 'text-green-500' },
  bulb:    { icon: 'ti-bulb',          bg: 'bg-purple-50', color: 'text-purple-400' },
  calc:    { icon: 'ti-calculator',    bg: 'bg-purple-50', color: 'text-purple-400' },
  clock:   { icon: 'ti-clock',         bg: 'bg-blue-50',   color: 'text-blue-400' },
  blank:   { icon: 'ti-file',          bg: 'bg-gray-100',  color: 'text-gray-400' },
};

const SECTIONS = [
  {
    label: 'ORDERS', count: 9, iconKey: 'cart',
    items: [
      { label: 'List Of Orders',              href: '/reports/orders/list-of-orders' },
      { label: 'Order Details',               href: '/reports/orders/order-details' },
      { label: 'Order Wise Payment Breakup',  href: '/reports/orders/order-wise-payment-breakup' },
      { label: 'Order Payment History',       href: '/reports/orders/order-payment-history' },
      { label: 'Order Transaction Tracker',   href: '/reports/orders/order-transaction-tracker' },
      { label: 'List Of Void Orders',         href: '/reports/orders/list-of-void-orders' },
      { label: 'Product In Orders',           href: '/reports/orders/product-in-orders' },
      { label: 'Product Transaction Tracker', href: '/reports/orders/product-transaction-tracker' },
      { label: 'Order Combo Report',          href: '/reports/orders/order-combo-report' },
    ],
  },
  {
    label: 'PROMOTIONS', count: 8, iconKey: 'trend',
    items: [
      { label: 'Product Discount Report',     href: '/reports/promotions/product-discount-report' },
      { label: 'Discount Expenses',           href: '/reports/promotions/discount-expenses' },
      { label: 'Discounted Products',         href: '/reports/promotions/discounted-products' },
      { label: 'Order Discount Report',       href: '/reports/promotions/order-discount-report' },
      { label: 'Coupon Redemption',           href: '/reports/promotions/coupon-redemption' },
      { label: 'Discount Performance Report', href: '/reports/promotions/discount-performance-report' },
      { label: 'Membership Tracker',          href: '/reports/promotions/membership-tracker' },
      { label: 'Membership Purchase History', href: '/reports/promotions/membership-purchase-history' },
    ],
  },
  {
    label: 'PROFORMA INVOICES', count: 7, iconKey: 'doc',
    items: [
      { label: 'List of PI',                          href: '/reports/proforma-invoices/list-of-pi' },
      { label: 'PI Detail',                           href: '/reports/proforma-invoices/pi-detail' },
      { label: 'Product in PI',                       href: '/reports/proforma-invoices/product-in-pi' },
      { label: 'PI Product Level Discount',           href: '/reports/proforma-invoices/pi-product-level-discount' },
      { label: 'PI Payment Breakup',                  href: '/reports/proforma-invoices/pi-payment-breakup' },
      { label: 'PI Payment History',                  href: '/reports/proforma-invoices/pi-payment-history' },
      { label: 'PI Product Sale Transaction Tracker', href: '/reports/proforma-invoices/pi-product-sale-transaction-tracker' },
    ],
  },
  {
    label: 'SALES', count: 19, iconKey: 'trend',
    items: [
      { label: 'Daily Sales',                 href: '/reports/sales/daily-sales' },
      { label: 'Monthly Sales',               href: '/reports/sales/monthly-sales' },
      { label: 'Location Wise Sales',         href: '/reports/sales/location-wise-sales' },
      { label: 'Region Wise Sales',           href: '/reports/sales/region-wise-sales' },
      { label: 'Store Wise Sales',            href: '/reports/sales/store-wise-sales' },
      { label: 'Store Wise Product Sales',    href: '/reports/sales/store-wise-product-sales' },
      { label: 'Device Wise Sales',           href: '/reports/sales/device-wise-sales' },
      { label: 'Customer Wise Sales',         href: '/reports/sales/customer-wise-sales' },
      { label: 'Employee Wise Sales',         href: '/reports/sales/employee-wise-sales' },
      { label: 'Employee Wise Product Sales', href: '/reports/sales/employee-wise-product-sales' },
      { label: 'Store Hourly Sales',          href: '/reports/sales/store-hourly-sales' },
      { label: 'Daily Payment Breakup',       href: '/reports/sales/daily-payment-breakup' },
      { label: 'Entity Wise Sales',           href: '/reports/sales/entity-wise-sales' },
      { label: 'Product Wise Sales',          href: '/reports/sales/product-wise-sales' },
      { label: 'Department Wise Sales',       href: '/reports/sales/department-wise-sales' },
      { label: 'Category Wise Sales',         href: '/reports/sales/category-wise-sales' },
      { label: 'Sub Category Wise Sales',     href: '/reports/sales/sub-category-wise-sales' },
      { label: 'Brand Wise Sales',            href: '/reports/sales/brand-wise-sales' },
      { label: 'Income Head Wise Sales',      href: '/reports/sales/income-head-wise-sales' },
      { label: 'Fiscal Report',              href: '/reports/sales/fiscal-report' },
    ],
  },
  {
    label: 'ONLINE ORDER', count: 4, iconKey: 'cart',
    items: [
      { label: 'List Of Online Orders',     href: '/reports/online-order/list-of-online-orders' },
      { label: 'Online Order Detail',       href: '/reports/online-order/online-order-detail' },
      { label: 'Product In Online Orders',  href: '/reports/online-order/product-in-online-orders' },
      { label: 'Product Wise Online Sales', href: '/reports/online-order/product-wise-online-sales' },
    ],
  },
  {
    label: 'INVENTORY', count: 15, iconKey: 'box',
    items: [
      { label: 'Stock Level',                 href: '/reports/inventory/stock-level' },
      { label: 'Store Wise Stock Level',      href: '/reports/inventory/store-wise-stock-level' },
      { label: 'Product Group Stock Level',   href: '/reports/inventory/product-group-stock-level' },
      { label: 'Stock Operations',            href: '/reports/inventory/stock-operations' },
      { label: 'Stock Operations Detail',     href: '/reports/inventory/stock-operations-detail' },
      { label: 'Stock Requisition',           href: '/reports/inventory/stock-requisition' },
      { label: 'Unfulfilled Stock Requests',  href: '/reports/inventory/unfulfilled-stock-requests' },
      { label: 'Unfulfilled Stock Transfers', href: '/reports/inventory/unfulfilled-stock-transfers' },
      { label: 'Product Ageing Report',       href: '/reports/inventory/product-ageing-report' },
      { label: 'Profit Margin',               href: '/reports/inventory/profit-margin' },
      { label: 'Low Stock Products',          href: '/reports/inventory/low-stock-products' },
      { label: 'Stock Ledger Summary',        href: '/reports/inventory/stock-ledger-summary' },
      { label: 'Stock Movement',              href: '/reports/inventory/stock-movement' },
      { label: 'Stock Movement Detail',       href: '/reports/inventory/stock-movement-detail' },
      { label: 'Stock Fulfillment',           href: '/reports/inventory/stock-fulfillment' },
    ],
  },
  {
    label: 'INSIGHTS', count: 14, iconKey: 'doc',
    items: [
      { label: 'ABC-XYZ Classification',       href: '/reports/insights/abc-xyz-classification' },
      { label: 'Inventory Accuracy Scorecard',  href: '/reports/insights/inventory-accuracy-scorecard' },
      { label: 'Dead Stock Detector',           href: '/reports/insights/dead-stock-detector' },
      { label: 'Stockout Predictor',            href: '/reports/insights/stockout-predictor' },
      { label: 'Smart Reorder',                 href: '/reports/insights/smart-reorder' },
      { label: 'GMROI Capital Efficiency',      href: '/reports/insights/gmroi-capital-efficiency' },
      { label: 'Bill-Level Margin Monitor',     href: '/reports/insights/bill-level-margin-monitor' },
      { label: 'Revenue Leakage Detector',      href: '/reports/insights/revenue-leakage-detector' },
      { label: 'Discount & Margin Analyzer',    href: '/reports/insights/discount-margin-analyzer' },
      { label: 'Basket & Affinity Insights',    href: '/reports/insights/basket-affinity-insights' },
      { label: 'POS Cash Variance Alerts',      href: '/reports/insights/pos-cash-variance-alerts' },
      { label: 'Purchase Price Variance',       href: '/reports/insights/purchase-price-variance' },
      { label: 'Fulfillment Leakage Tracker',   href: '/reports/insights/fulfillment-leakage-tracker' },
      { label: 'Store Peer Benchmarking',       href: '/reports/insights/store-peer-benchmarking' },
    ],
  },
  {
    label: 'ACCOUNTING REPORTS', count: 3, iconKey: 'calc',
    items: [
      { label: 'Order Wise Tax Breakup',   href: '/reports/accounting/order-wise-tax-breakup' },
      { label: 'Product Wise Tax Breakup', href: '/reports/accounting/product-wise-tax-breakup' },
      { label: 'HSN/SAC Wise Tax Breakup', href: '/reports/accounting/hsn-sac-wise-tax-breakup' },
    ],
  },
  {
    label: 'PURCHASE', count: 11, iconKey: 'box',
    items: [
      { label: 'List Of Purchase Orders',         href: '/reports/purchase/list-of-purchase-orders' },
      { label: 'Product In Purchase Orders',      href: '/reports/purchase/product-in-purchase-orders' },
      { label: 'Purchase Order Details',          href: '/reports/purchase/purchase-order-details' },
      { label: 'Vendor Tax Input',                href: '/reports/purchase/vendor-tax-input' },
      { label: 'Vendor Purchase Summary',         href: '/reports/purchase/vendor-purchase-summary' },
      { label: 'Vendor Product Purchase Summary', href: '/reports/purchase/vendor-product-purchase-summary' },
      { label: 'Vendor Quotation Comparison',     href: '/reports/purchase/vendor-quotation-comparison' },
      { label: 'Purchase Return Report',          href: '/reports/purchase/purchase-return-report' },
      { label: 'Vendor Ledger Report',            href: '/reports/purchase/vendor-ledger-report' },
      { label: 'Vendor Performance Report',       href: '/reports/purchase/vendor-performance-report' },
      { label: 'Auto Reorder Suggestions',        href: '/reports/purchase/auto-reorder-suggestions' },
    ],
  },
  {
    label: 'CUSTOM REPORTS', count: 2, iconKey: 'blank',
    items: [
      { label: 'ELR Report',          href: '/reports/custom/elr-report' },
      { label: 'Daily Sales Summary', href: '/reports/custom/daily-sales-summary' },
    ],
  },
  {
    label: 'LOGS', count: 4, iconKey: 'clock',
    items: [
      { label: 'Product Logs',       href: '/reports/logs/product-logs' },
      { label: 'System Change Logs', href: '/reports/logs/system-change-logs' },
      { label: 'Order Sync Logs',    href: '/reports/logs/order-sync-logs' },
      { label: 'Audit Trail',        href: '/reports/logs/audit-trail' },
    ],
  },
];

function ReportCard({ item, iconKey }) {
  const { icon, bg, color } = ICON[iconKey];
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 px-4 py-4 hover:bg-gray-50 transition-colors border-b border-r border-gray-100 last:border-b-0"
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
        <i className={`ti ${icon} text-[15px] ${color}`} />
      </span>
      <span className="text-[13px] text-gray-700 font-medium leading-snug">{item.label}</span>
    </Link>
  );
}

export default function ReportsHomePage() {
  const [search, setSearch] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledReports, setScheduledReports] = useState([]);
  const [scheduleDraft, setScheduleDraft] = useState({
    reportHref: '/reports/sales/daily-sales',
    frequency: 'daily',
    format: 'xlsx',
    email: '',
  });
  const allItems = useMemo(
    () => SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, iconKey: s.iconKey }))),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const res = await fetch('/api/reports/dashboard', { cache: 'no-store', credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && json?.success) setDashboard(json.data);
      } catch (err) {
        console.error('[ReportsHomePage] Failed to load dashboard', err);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      fetch('/api/reports/schedules', { cache: 'no-store' })
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setScheduledReports(json.data.records || []);
          else {
            const saved = JSON.parse(localStorage.getItem('scheduledReports') || '[]');
            if (Array.isArray(saved)) setScheduledReports(saved);
          }
        })
        .catch(() => {
          const saved = JSON.parse(localStorage.getItem('scheduledReports') || '[]');
          if (Array.isArray(saved)) setScheduledReports(saved);
        });
    } catch {
      setScheduledReports([]);
    }
  }, []);

  const filtered = search.trim()
    ? allItems.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()))
    : null;
  const livePinned = PINNED.map((card) => {
    if (card.href === '/reports/orders/list-of-orders') {
      return {
        ...card,
        value: dashboard?.pinned?.orders?.label || 'Loading...',
        change: dashboard?.pinned?.orders?.change || null,
      };
    }
    if (card.href === '/reports/sales/daily-sales') {
      return {
        ...card,
        value: dashboard?.pinned?.dailySales?.label || 'Loading...',
        change: dashboard?.pinned?.dailySales?.change || null,
      };
    }
    if (card.href === '/reports/net-sales') {
      return {
        ...card,
        value: dashboard?.pinned?.netSales?.label || 'Loading...',
        change: dashboard?.pinned?.netSales?.change || null,
      };
    }
    if (card.href === '/reports/inventory/stock-level') {
      const low = Number(dashboard?.pinned?.stockLevel?.low || 0);
      return {
        ...card,
        value: dashboard?.pinned?.stockLevel?.label || 'Loading...',
        badge: dashboard?.pinned?.stockLevel ? `${low} low` : '',
        extra: dashboard?.pinned?.stockLevel ? (low > 0 ? 'Needs attention' : 'Healthy') : '',
      };
    }
    return card;
  });

  const downloadReport = async (url) => {
    if (!url) return;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      alert('Unable to download report');
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  const openPinnedExcel = () => {
    downloadReport('/api/reports/sales/daily-sales?export=xlsx');
  };

  const getReportExportUrl = (href) => {
    const reportKey = String(href || '').replace(/^\/reports\/?/, '');
    if (!reportKey) return '';
    return `/api/reports/${reportKey}?export=xlsx`;
  };

  const handleGenerateScheduledReport = () => {
    const url = getReportExportUrl(scheduleDraft.reportHref);
    if (url) downloadReport(url);
  };

  const handleSaveSchedule = async () => {
    const report = allItems.find((item) => item.href === scheduleDraft.reportHref);
    if (!report) return;

    const payload = {
      reportHref: scheduleDraft.reportHref,
      reportLabel: report.label,
      frequency: scheduleDraft.frequency,
      format: scheduleDraft.format,
      email: scheduleDraft.email.trim(),
    };

    try {
      const res = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Failed');
      setScheduledReports((current) => [json.data.schedule, ...current].slice(0, 10));
      setShowSchedule(false);
    } catch {
      const fallback = { id: `${Date.now()}`, ...payload, createdAt: new Date().toISOString() };
      const next = [fallback, ...scheduledReports].slice(0, 10);
      setScheduledReports(next);
      localStorage.setItem('scheduledReports', JSON.stringify(next));
      setShowSchedule(false);
    }
  };

  return (
    <MainLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-lg leading-relaxed">
            Every report across QueueBuster, in one place. Pin the ones you check daily —
            they'll stay at the top and on your sidebar.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            type="button"
            onClick={() => setShowSchedule(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            <i className="ti ti-calendar-down text-[14px]" />
            Schedule reports
          </button>
          <button
            onClick={openPinnedExcel}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg bg-white text-xs text-gray-700 hover:bg-gray-50 transition"
          >
            <i className="ti ti-external-link text-[14px]" />
            Open in Excel
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 20 20">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M15 15l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          placeholder={`Search 60+ reports — try "tax", "void", "stock movement"...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-14 py-3 border border-gray-200 rounded-xl text-sm bg-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">⌘K</span>
      </div>

      {/* Search Results */}
      {filtered && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">Search Results</span>
            <span className="text-xs text-gray-400">{filtered.length}</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((item) => (
                <ReportCard key={item.href} item={item} iconKey={item.iconKey} />
              ))}
            </div>
          </div>
        </div>
      )}

      {!filtered && (
        <div className="space-y-6">

          {/* PINNED */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">Pinned · Live</span>
              <span className="text-xs text-gray-400">{PINNED.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {livePinned.map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow block group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-[13px] font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">{card.label}</span>
                    <span className="text-[11px] text-gray-400 shrink-0 ml-1">{card.subtitle}</span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-xl font-bold text-gray-900">{card.value}</span>
                    {card.badge && <span className="text-xs text-gray-400">{card.badge}</span>}
                  </div>
                  {card.change && <p className="text-xs text-green-500">↑ {card.change}</p>}
                  {card.extra && <p className="text-xs text-blue-500">{card.extra}</p>}
                  <div className={`h-0.5 rounded-full mt-3 ${card.barColor} opacity-50`} />
                </Link>
              ))}
            </div>
          </div>

          {/* Report Sections */}
          {SECTIONS.map((section) => {
            const empty = 3 - (section.items.length % 3 === 0 ? 3 : section.items.length % 3);
            return (
              <div key={section.label}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{section.label}</span>
                  <span className="text-xs text-gray-400">{section.count}</span>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {section.items.map((item) => (
                      <ReportCard key={item.href} item={item} iconKey={section.iconKey} />
                    ))}
                    {/* Fill last row */}
                    {empty < 3 && Array.from({ length: empty }).map((_, i) => (
                      <div key={i} className="px-4 py-4 border-b border-r border-gray-100 bg-gray-50/40" />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

        </div>
      )}

      {showSchedule && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 sm:p-6">
          <div className="mt-10 w-full max-w-2xl rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Schedule reports</h2>
                <p className="mt-0.5 text-xs text-gray-500">Save a repeat schedule or generate the selected report now.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSchedule(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close schedule reports"
              >
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-gray-700">Report</span>
                <select
                  value={scheduleDraft.reportHref}
                  onChange={(event) => setScheduleDraft({ ...scheduleDraft, reportHref: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                >
                  {allItems.map((item) => (
                    <option key={item.href} value={item.href}>{item.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Frequency</span>
                <select
                  value={scheduleDraft.frequency}
                  onChange={(event) => setScheduleDraft({ ...scheduleDraft, frequency: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Format</span>
                <select
                  value={scheduleDraft.format}
                  onChange={(event) => setScheduleDraft({ ...scheduleDraft, format: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-gray-700">Email recipients</span>
                <input
                  value={scheduleDraft.email}
                  onChange={(event) => setScheduleDraft({ ...scheduleDraft, email: event.target.value })}
                  placeholder="name@example.com, finance@example.com"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500"
                />
              </label>

              {scheduledReports.length > 0 && (
                <div className="sm:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Saved schedules</div>
                  <div className="space-y-1.5">
                    {scheduledReports.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 text-xs text-gray-700">
                        <span className="truncate">{item.reportLabel}</span>
                        <span className="shrink-0 capitalize text-gray-500">{item.frequency}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={handleGenerateScheduledReport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                <i className="ti ti-download text-[16px]" />
                Generate now
              </button>
              <button
                type="button"
                onClick={() => setShowSchedule(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSchedule}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Save schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
