'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import { formatIndianDate } from '@/lib/dateUtils';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
} from 'recharts';

const tabs = [
  { key: 'overview', label: 'Overview', icon: 'ti-layout-grid' },
  { key: 'stockin', label: 'Stock In', icon: 'ti-inbox' },
  { key: 'stockout', label: 'Stock Out', icon: 'ti-logout-2' },
  { key: 'transfers', label: 'Transfers', icon: 'ti-arrows-exchange' },
  { key: 'audit', label: 'Stock Audit', icon: 'ti-shield-check' },
  { key: 'batches', label: 'Batches - Expiry', icon: 'ti-box' },
];

const baseStats = [
  { key: 'stock_on_hand', label: 'Stock on hand', note: 'Across all stores' },
  { key: 'out_of_stock', label: 'SKUs out of stock', note: 'Zero-stock items' },
  { key: 'stockout_risk', label: 'Stockout risk (7d)', note: 'At or below reorder level', status: 'warning' },
  { key: 'total_products', label: 'Live products', note: 'Active catalogue coverage' },
];

const listConfig = {
  stockin: {
    title: 'Stock In',
    endpoint: '/api/inventory/stockin',
    headers: [
      'Transaction ID',
      'Invoice Number',
      'Destination',
      'Invoice Date',
      'Total Item Number',
      'Cost',
      'Reference Transaction Type',
      'Reference ID',
    ],
    map: (row) => ({
      'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#STK-${row.id}`,
      'Invoice Number': row.invoiceNumber || '-',
      Destination: row.destination || '-',
      'Invoice Date': formatDate(row.invoiceDate),
      'Total Item Number': row.totalItems ?? 0,
      Cost: formatCost(row.cost),
      'Reference Transaction Type': row.referenceType || '-',
      'Reference ID': row.referenceId || '-',
    }),
  },
  stockout: {
    title: 'Stock Out',
    endpoint: '/api/inventory/stockout',
    headers: [
      'Transaction ID',
      'Invoice Number',
      'Destination',
      'Invoice Date',
      'Total Item Number',
      'Cost',
      'Reference Transaction Type',
      'Reference ID',
    ],
    map: (row) => ({
      'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#STKO-${row.id}`,
      'Invoice Number': row.invoiceNumber || '-',
      Destination: row.destination || 'All',
      'Invoice Date': formatDate(row.invoiceDate),
      'Total Item Number': row.totalItems ?? 0,
      Cost: formatCost(row.cost),
      'Reference Transaction Type': row.referenceType || '-',
      'Reference ID': row.referenceId || '-',
    }),
  },
  transfers: {
    title: 'Transfers',
    endpoint: '/api/inventory/stocktransfer',
    headers: [
      'Transaction ID',
      'Invoice Number',
      'Source Name',
      'Destination Name',
      'Invoice Date',
      'Total Item Number',
      'Cost',
    ],
    map: (row) => ({
      'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#TRN-${row.id}`,
      'Invoice Number': row.invoiceNumber || '-',
      'Source Name': row.sourceName || '-',
      'Destination Name': row.destinationName || '-',
      'Invoice Date': formatDate(row.invoiceDate),
      'Total Item Number': row.totalItems ?? 0,
      Cost: formatCost(row.cost),
    }),
  },
  audit: {
    title: 'Stock Audit',
    endpoint: '/api/inventory/stockvalidation',
    headers: [
      'Transaction ID',
      'Invoice Number',
      'Source Name',
      'Invoice Date',
      'Total Item Number',
      'Cost',
    ],
    map: (row) => ({
      'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#AUD-${row.id}`,
      'Invoice Number': row.invoiceNumber || '-',
      'Source Name': row.sourceName || 'None',
      'Invoice Date': formatDate(row.invoiceDate),
      'Total Item Number': row.totalItems ?? 0,
      Cost: formatCost(row.cost),
    }),
  },
  batches: {
    title: 'Batches - Expiry',
    endpoint: null,
    headers: ['Batch ID', 'Product', 'Store', 'Expiry Date', 'Qty', 'Status'],
    map: (row) => row,
  },
};

function formatDate(value) {
  return formatIndianDate(value, '-');
}

function formatCost(value) {
  const n = Number(value || 0);
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function InventoryOpsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [overviewData, setOverviewData] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [storeCount, setStoreCount] = useState(0);
  const [recentMovements, setRecentMovements] = useState([]);

  const activeConfig = listConfig[activeTab];

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const params = new URLSearchParams();
        const dateFrom = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
        const dateTo = new Date().toISOString().split('T')[0];
        params.set('date_from', dateFrom);
        params.set('date_to', dateTo);

        const [analyticsRes, storesRes, stockInRes, stockOutRes, stockTransferRes] = await Promise.all([
          fetch(`/api/dashboard/analytics?${params.toString()}`),
          fetch('/api/stores'),
          fetch('/api/inventory/stockin'),
          fetch('/api/inventory/stockout'),
          fetch('/api/inventory/stocktransfer'),
        ]);

        const analyticsJson = analyticsRes.ok ? await analyticsRes.json() : null;
        const storesJson = storesRes.ok ? await storesRes.json() : null;
        const [stockInJson, stockOutJson, stockTransferJson] = await Promise.all([
          stockInRes.ok ? stockInRes.json() : Promise.resolve([]),
          stockOutRes.ok ? stockOutRes.json() : Promise.resolve([]),
          stockTransferRes.ok ? stockTransferRes.json() : Promise.resolve([]),
        ]);

        if (cancelled) return;

        if (analyticsJson?.success && analyticsJson.data) {
          setOverviewData(analyticsJson.data);
        } else {
          setOverviewData(null);
        }

        const count = Array.isArray(storesJson)
          ? storesJson.length
          : storesJson?.data?.stores?.length || storesJson?.data?.records?.length || 0;
        setStoreCount(count);

        const movements = [
          ...mapInventoryMovements(stockInJson, 'Stock In'),
          ...mapInventoryMovements(stockOutJson, 'Stock Out'),
          ...mapInventoryMovements(stockTransferJson, 'Transfer'),
        ]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 8);

        setRecentMovements(movements);
      } catch (err) {
        if (!cancelled) {
          setOverviewData(null);
          setStoreCount(0);
          setRecentMovements([]);
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    }

    loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  const overviewStats = useMemo(() => {
    const inventory = overviewData?.inventory || {};
    const stockAlerts = Array.isArray(overviewData?.stock_alerts) ? overviewData.stock_alerts : [];

    const formatCount = (value) => Number(value || 0).toLocaleString('en-IN');
    const outOfStockCount = stockAlerts.filter((item) => Number(item.current_stock || 0) <= 0).length;
    const stockoutRiskCount = stockAlerts.filter((item) => Number(item.current_stock || 0) <= Number(item.reorder_level || 0)).length;

    return baseStats.map((stat) => {
      if (stat.key === 'stock_on_hand') {
        return { label: stat.label, note: stat.note, value: formatCount(inventory.total_stock_units) };
      }
      if (stat.key === 'out_of_stock') {
        return { label: stat.label, note: stat.note, value: formatCount(outOfStockCount) };
      }
      if (stat.key === 'stockout_risk') {
        return { label: stat.label, note: stat.note, value: formatCount(stockoutRiskCount), status: 'warning' };
      }
      if (stat.key === 'total_products') {
        return { label: stat.label, note: stat.note, value: formatCount(inventory.total_products) };
      }
      return { label: stat.label, note: stat.note, value: '-' };
    });
  }, [overviewData]);

  const stockoutForecast = useMemo(() => {
    const source = Array.isArray(overviewData?.stock_forecast) && overviewData.stock_forecast.length > 0
      ? overviewData.stock_forecast
      : Array.isArray(overviewData?.stock_alerts) ? overviewData.stock_alerts : [];

    return source
      .map((item) => {
        const currentStock = Number(item.current_stock || 0);
        const sold30 = Number(item.last_30days_sales || 0);
        const daysOfCoverRaw = item.days_of_cover == null ? Number.POSITIVE_INFINITY : Number(item.days_of_cover);
        const daysOfCover = Number.isFinite(daysOfCoverRaw) ? daysOfCoverRaw : Number.POSITIVE_INFINITY;

        return {
          id: item.id,
          name: item.name || 'Unknown product',
          sku: item.sku || '-',
          currentStock,
          reorderLevel: Number(item.reorder_level || 0),
          sold30,
          daysOfCover,
          status: currentStock <= 0 ? 'Out of stock' : daysOfCover <= 7 ? 'High risk' : daysOfCover <= 14 ? 'Watch' : 'Healthy',
        };
      })
      .slice(0, 8);
  }, [overviewData]);

  const stockoutGraphData = useMemo(() => {
    return stockoutForecast.map((item) => ({
      ...item,
      shortName: item.name.length > 18 ? `${item.name.slice(0, 18)}...` : item.name,
      coverageGap: Math.max(0, Number(item.reorderLevel || 0) - Number(item.currentStock || 0)),
    }));
  }, [stockoutForecast]);

  useEffect(() => {
    if (activeTab === 'overview') return;
    if (!activeConfig?.endpoint) {
      setRecords([]);
      return;
    }

    setLoading(true);
    fetch(activeConfig.endpoint)
      .then((res) => {
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => setRecords(Array.isArray(data) ? data : []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [activeTab, activeConfig?.endpoint]);

  const tableRows = useMemo(() => {
    if (!activeConfig) return [];
    return records.map(activeConfig.map);
  }, [activeConfig, records]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return tableRows;
    const q = searchTerm.trim().toLowerCase();
    const headers = activeConfig?.headers || [];
    return tableRows.filter((row) =>
      headers.some((header) => String(row[header] ?? '').toLowerCase().includes(q))
    );
  }, [tableRows, searchTerm, activeConfig?.headers]);

  const downloadCsv = (headers, rows, filename) => {
    const esc = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [headers.map(esc).join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => esc(row[h] ?? '')).join(','));
    }

    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (activeTab === 'overview') {
      alert('Select a tab to export transactions.');
      return;
    }
    if (!filteredRows.length) {
      alert('No records to export.');
      return;
    }

    const headers = activeConfig?.headers || [];
    const filename = `inventory-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(headers, filteredRows, filename);
  };

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Home</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Inventory</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Inventory</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            {overviewLoading
              ? 'Loading live inventory data...'
              : `${storeCount} stores · ${Number(overviewData?.inventory?.total_products || 0).toLocaleString('en-IN')} products · Updated live`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => router.push('/inventory/stockin')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-300 text-[13px] font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <i className="ti ti-upload text-[16px]" />
            Import stock
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-300 text-[13px] font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <i className="ti ti-download text-[16px]" />
            Export
          </button>
          <button
            type="button"
            onClick={() => router.push('/inventory/stockin')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 text-[13px] font-medium text-white hover:bg-gray-800 transition-colors"
          >
            <i className="ti ti-plus text-[16px]" />
            Stock In
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-gray-200 mb-6 overflow-x-auto pb-2">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                if (tab.key === 'batches') {
                  router.push('/inventory/batches');
                  return;
                }
                setActiveTab(tab.key);
              }}
              className={`flex items-center gap-2 pb-3 px-1 text-[13.5px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? 'text-gray-900 border-b-gray-900'
                  : 'text-gray-500 border-b-transparent hover:text-gray-700'
              }`}
            >
              <i className={`ti ${tab.icon} text-[16px]`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' ? (
        <OverviewContent
          stats={overviewLoading ? baseStats.map((stat) => ({ label: stat.label, note: stat.note })) : overviewStats}
          recentMovements={recentMovements}
          stockoutForecast={stockoutForecast}
          stockoutGraphData={stockoutGraphData}
          onViewAll={() => setActiveTab('stockin')}
        />
      ) : (
        <InventoryListPanel
          title={activeConfig.title}
          headers={activeConfig.headers}
          rows={filteredRows}
          loading={loading}
          emptyMessage={activeTab === 'batches' ? 'No expiring batches found' : 'No Records Found'}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
        />
      )}
    </MainLayout>
  );
}

function OverviewContent({ stats, recentMovements, stockoutForecast, stockoutGraphData, onViewAll }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <p className="text-[12px] font-medium text-gray-500">{stat.label}</p>
            <div className="mt-3 flex items-end gap-2">
              {stat.value === '-' ? (
                <div className="w-10 h-1 rounded-full bg-gray-300" />
              ) : (
                <span className="text-[28px] font-bold text-gray-900">{stat.value}</span>
              )}
              {stat.status === 'warning' && (
                <i className="ti ti-alert-triangle text-orange-500 text-[18px]" />
              )}
            </div>
            <p className={`text-[11.5px] mt-2 ${stat.status === 'warning' ? 'text-orange-600' : 'text-gray-400'}`}>
              {stat.note}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[14px] font-semibold text-gray-900">Recent stock movements</h3>
              <p className="text-[12px] text-gray-500 mt-0.5">Latest confirmed stock-in, stock-out and transfer activity</p>
            </div>
            <button type="button" onClick={onViewAll} className="text-[12px] font-medium text-blue-600 hover:underline">
              View all <i className="ti ti-arrow-right text-[12px] inline ml-1" />
            </button>
          </div>
          <div className="space-y-3">
            {recentMovements.length > 0 ? recentMovements.map((movement) => (
              <div key={`${movement.type}-${movement.id}`} className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 p-4 bg-gray-50/60">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">{movement.type}</span>
                    <span className="text-[12px] text-gray-400">{formatDate(movement.timestamp)}</span>
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900 mt-1">{movement.title}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{movement.subtitle}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-semibold text-gray-900">{movement.value}</p>
                  <p className="text-[11px] text-gray-400">{movement.reference}</p>
                </div>
              </div>
            )) : (
              <div className="flex items-center justify-center py-12">
                <p className="text-[13px] text-gray-400">No confirmed stock movements found.</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[14px] font-semibold text-gray-900">Stockout forecast</h3>
              <p className="text-[12px] text-gray-500 mt-0.5">Live days-of-cover projection from sales and stock alerts</p>
            </div>
          </div>
          {stockoutGraphData.length > 0 ? (
            <div className="space-y-6">
              <div className="rounded-xl border border-gray-100 p-4 bg-gray-50/40">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900">Stock vs reorder level</p>
                    <p className="text-[12px] text-gray-500">Current stock against the configured threshold</p>
                  </div>
                </div>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stockoutGraphData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="shortName" tick={{ fontSize: 12 }} interval={0} height={60} angle={-15} textAnchor="end" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="currentStock" stroke="#B00000" strokeWidth={2.5} dot={{ r: 3 }} name="Current stock" />
                      <Line type="monotone" dataKey="reorderLevel" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} name="Reorder level" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-[13px] text-gray-400">No stockout risk records found.</p>
            </div>
          )}
      </div>
      </div>
    </>
  );
}

function mapInventoryMovements(rows, type) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (!row) return null;

      if (type === 'Stock In') {
        return {
          id: row.id,
          type,
          title: row.invoiceNumber || row.transactionId || 'Stock in',
          subtitle: row.destination || 'Destination store',
          value: `${Number(row.totalItems || 0)} items`,
          reference: row.vendorName || row.referenceType || 'Confirmed',
          timestamp: row.createdAt || row.invoiceDate || new Date().toISOString(),
        };
      }

      if (type === 'Stock Out') {
        return {
          id: row.id,
          type,
          title: row.invoiceNumber || row.transactionId || 'Stock out',
          subtitle: row.destination || 'Store',
          value: `${Number(row.totalItems || 0)} items`,
          reference: row.referenceType || row.referenceId || 'Confirmed',
          timestamp: row.createdAt || row.invoiceDate || new Date().toISOString(),
        };
      }

      return {
        id: row.id,
        type,
        title: row.invoiceNumber || row.transactionId || 'Transfer',
        subtitle: `${row.sourceName || '-'} → ${row.destinationName || '-'}`,
        value: `${Number(row.totalItems || 0)} items`,
        reference: 'Confirmed',
        timestamp: row.createdAt || row.invoiceDate || new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function InventoryListPanel({ title, headers, rows, loading, emptyMessage, searchTerm, onSearchTermChange }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 justify-between flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">Confirmed inventory transactions</p>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[340px] bg-gray-50 rounded-lg px-3 py-2">
          <i className="ti ti-search text-gray-400 text-[16px]" />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => onSearchTermChange(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px]">
          <thead>
            <tr className="border-b border-gray-100">
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
                  {headers.map((header) => (
                    <td key={header} className="px-4 py-3 text-[13px] text-gray-700">
                      {row[header] ?? '-'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length} className="px-4 py-14 text-center text-[14px] text-blue-700 font-medium">
                  {loading ? 'Loading records...' : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-400">
        <select className="border border-gray-200 rounded-lg px-3 py-2 bg-white text-[12px] text-gray-600">
          <option>10</option>
        </select>
        <span>Showing {rows.length ? 1 : 0} to {rows.length} of {rows.length} Results</span>
      </div>
    </div>
  );
}
