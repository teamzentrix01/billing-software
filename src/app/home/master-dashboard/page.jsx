'use client';

import { useEffect, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export default function MasterDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(getPastDate(30));
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [storeId, setStoreId] = useState('all');
  const [stores, setStores] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [staffQuery, setStaffQuery] = useState('');
  const liveRefreshMs = 15000;

  useEffect(() => { fetchStores(); }, []);
  useEffect(() => { fetchDashboardData(); }, [dateFrom, dateTo, storeId]);
  useEffect(() => {
    const refreshTimer = setInterval(() => { fetchDashboardData({ silent: true }); }, liveRefreshMs);
    return () => clearInterval(refreshTimer);
  }, [dateFrom, dateTo, storeId]);

  async function fetchStores() {
    try {
      const res = await fetch('/api/stores');
      const json = await res.json();
      const storeList = Array.isArray(json)
        ? json
        : json.data?.stores || json.data?.records || json.stores || [];
      if (Array.isArray(storeList)) setStores(storeList);
    } catch (err) { console.error('Error fetching stores:', err); }
  }

  async function fetchDashboardData({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
      if (storeId !== 'all') params.set('store_id', storeId);
      const res = await fetch(`/api/dashboard/analytics?${params}`, { cache: 'no-store' });
      if (!res.ok) { console.error(`API error: ${res.status}`); setLoading(false); return; }
      const json = await res.json();
      const analyticsData = json?.data || json;
      if (analyticsData) { setData(analyticsData); setLastUpdated(new Date()); }
    } catch (err) { console.error('Error fetching dashboard data:', err); }
    finally { if (!silent) setLoading(false); }
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin" />
          <p className="text-sm font-bold text-slate-600">Loading dashboard…</p>
          <p className="text-xs text-slate-400">Fetching analytics data</p>
        </div>
      </MainLayout>
    );
  }

  if (!data) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center text-2xl">⚠️</div>
          <h3 className="text-base font-black text-slate-800">No Data Available</h3>
          <p className="text-sm text-slate-500 max-w-xs text-center">Dashboard data could not be loaded. Please ensure you are logged in and try again.</p>
        </div>
      </MainLayout>
    );
  }

  const COLORS = ['#B00000', '#539D62', '#f59e0b', '#ef4444', '#8b5cf6'];
  const staffWindowSource = Array.isArray(data.staff_productivity) ? data.staff_productivity : [];
  const staffQueryNormalized = staffQuery.trim().toLowerCase();
  const staffWindow = staffQueryNormalized
    ? staffWindowSource.filter((person) => {
        const name = String(person.name || '').toLowerCase();
        const id = String(person.id || '').toLowerCase();
        return name.includes(staffQueryNormalized) || id.includes(staffQueryNormalized);
      })
    : staffWindowSource;

  const fmt = (v) => parseFloat(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const paymentModesSource = Array.isArray(data.payment_modes) ? data.payment_modes : [];
  const paymentModesData = paymentModesSource
    .map((mode, index) => {
      const paymentMode = String(mode.payment_mode || mode.paymentMode || mode.method || `Mode ${index + 1}`);
      const amount = Number.parseFloat(mode.amount ?? mode.total_amount ?? mode.value ?? 0);
      const transactions = Number.parseInt(mode.transactions ?? mode.count ?? 0, 10);
      return {
        payment_mode: paymentMode,
        amount: Number.isFinite(amount) ? amount : 0,
        transactions: Number.isFinite(transactions) ? transactions : 0,
      };
    })
    .filter((mode) => mode.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const paymentModesTotal = paymentModesData.reduce((sum, mode) => sum + mode.amount, 0);

  return (
    <MainLayout>
      <div className="min-h-screen bg-slate-50/60">

        {/* ── HEADER BAR ── */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 rounded-2xl mb-5 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Title */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/30 border border-indigo-400/30 flex items-center justify-center text-lg shrink-0">
                📊
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Analytics Overview</p>
                <h1 className="text-xl font-black text-white tracking-tight leading-tight">Master Dashboard</h1>
              </div>
            </div>

            {/* Filters + Live Badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white/8 border border-white/10 rounded-xl px-3 py-2">
                <span className="text-[9px] font-black text-white uppercase tracking-wider shrink-0">From</span>
                <input
                  type="date" value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-white text-xs font-semibold focus:outline-none w-[110px]"
                  style={{ color: '#ffffff', WebkitTextFillColor: '#ffffff', colorScheme: 'dark' }}
                />
              </div>
              <div className="flex items-center gap-1.5 bg-white/8 border border-white/10 rounded-xl px-3 py-2">
                <span className="text-[9px] font-black text-white uppercase tracking-wider shrink-0">To</span>
                <input
                  type="date" value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-white text-xs font-semibold focus:outline-none w-[110px]"
                  style={{ color: '#ffffff', WebkitTextFillColor: '#ffffff', colorScheme: 'dark' }}
                />
              </div>
              <select
                value={storeId} onChange={(e) => setStoreId(e.target.value)}
                className="bg-white/8 border border-white/10 text-white text-xs font-semibold rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
                style={{ color: '#ffffff', WebkitTextFillColor: '#ffffff' }}
              >
                <option value="all" className="text-slate-900 bg-white">All Stores</option>
                {stores.map((store, idx) => (
                  <option key={store.id ?? `store-${idx}`} value={store.id} className="text-slate-900 bg-white">{store.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-400/25 rounded-xl px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="text-white text-[10px] font-black uppercase tracking-wider">Live</span>
                {lastUpdated && (
                  <span className="text-white text-[9px] font-semibold hidden sm:inline">
                    · {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 pb-6">

          {/* ── KPI CARDS ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              title="Total Sales" icon="💰" accent="indigo"
              value={`₹${fmt(data.summary?.total_sales)}`}
              subtitle={`${data.summary?.total_transactions || 0} transactions`}
            />
            <KPICard
              title="Gross Profit" icon="📈" accent="emerald"
              value={`₹${fmt(data.profitability?.gross_profit)}`}
              subtitle={`${data.profitability?.gross_margin_percent || 0}% margin`}
            />
            <KPICard
              title="Tax Collected" icon="🧾" accent="violet"
              value={`₹${fmt(data.summary?.total_tax)}`}
              subtitle="GST & other taxes"
            />
            <KPICard
              title="Unique Customers" icon="👥" accent="amber"
              value={data.summary?.unique_customers || 0}
              subtitle={`Avg ₹${parseFloat(data.summary?.avg_transaction_value || 0).toFixed(0)}/txn`}
            />
          </div>

          {/* ── INVENTORY + PAYMENT ROW ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon="📦" title="Inventory Valuation" />
              <div className="mt-3 space-y-2">
                <StatRow label="Total Products" value={data.inventory?.total_products || 0} />
                <StatRow label="Total Units" value={data.inventory?.total_stock_units || 0} />
                <StatRow label="Value @ Cost" value={`₹${fmt(data.inventory?.inventory_value_cost)}`} highlight />
                <StatRow label="Value @ Retail" value={`₹${fmt(data.inventory?.inventory_value_retail)}`} highlight />
              </div>
            </Card>

            <Card>
              <CardHeader icon="💳" title="Top 5 Payment Modes" />
              {paymentModesData.length > 0 && paymentModesTotal > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={paymentModesData}
                      dataKey="amount"
                      nameKey="payment_mode"
                      cx="50%"
                      cy="44%"
                      outerRadius={84}
                      innerRadius={34}
                      minAngle={5}
                      paddingAngle={2}
                    >
                      {paymentModesData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, _name, item) => [`₹${fmt(value)}`, `${item?.payload?.payment_mode || 'Mode'}`]}
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 700 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyState text="No payment data" />}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon="🤝" title="Vendor & Payables" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniStat label="Total Vendors" value={data.vendor_summary?.total_vendors || 0} />
                <MiniStat label="Active" value={data.vendor_summary?.active_vendors || 0} />
                <MiniStat label="Pending Bills" value={data.vendor_summary?.pending_vendor_invoices || 0} />
                <MiniStat label="Buying Vendors" value={data.vendor_summary?.purchasing_vendors || 0} />
              </div>
              <div className="mt-3 space-y-2">
                <StatRow label="Purchases in Period" value={`₹${fmt(data.vendor_summary?.purchase_value)}`} highlight />
                <StatRow label="Total Payable" value={`₹${fmt(data.vendor_summary?.total_payable)}`} highlight />
              </div>
            </Card>

            <Card>
              <CardHeader icon="📋" title="Top Vendors by Purchase" />
              {data.top_vendors?.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="pb-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Vendor</th>
                        <th className="pb-2 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Purchases</th>
                        <th className="pb-2 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Items</th>
                        <th className="pb-2 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_vendors.map((vendor, idx) => (
                        <tr key={`vendor-${idx}-${vendor.id ?? vendor.vendor_name ?? 'na'}`} className="border-b border-slate-50 hover:bg-indigo-50/40 transition-colors">
                          <td className="py-2 text-xs font-semibold text-slate-800">{vendor.vendor_name}</td>
                          <td className="py-2 text-right text-xs font-black text-slate-700">{vendor.purchase_count || 0}</td>
                          <td className="py-2 text-right text-xs font-semibold text-slate-600">{Number(vendor.items || 0).toLocaleString('en-IN')}</td>
                          <td className="py-2 text-right text-xs font-black text-indigo-600">₹{fmt(vendor.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState text="No vendor purchase data" />}
            </Card>
          </div>

          {/* ── SALES TREND ── */}
          <Card>
            <CardHeader icon="📉" title="Daily Sales Trend" />
            {data.sales_trends?.length > 0 ? (
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.sales_trends}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#B00000" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#B00000" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value) => `₹${fmt(value)}`}
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                    <Line type="monotone" dataKey="sales" stroke="#B00000" name="Sales" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="profit" stroke="#539D62" name="Profit" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState text="No sales data for this period" />}
          </Card>

          {/* ── STORE PERFORMANCE ── */}
          <Card>
            <CardHeader icon="🏪" title="Store-wise Performance" />
            {data.store_performance?.length > 0 ? (
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.store_performance} barCategoryGap="35%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="store_name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value) => `₹${fmt(value)}`}
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                    <Bar dataKey="sales" fill="#B00000" name="Sales" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="profit" fill="#539D62" name="Profit" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState text="No store performance data" />}
          </Card>

          {/* ── TOP CUSTOMERS + STAFF ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Top Customers */}
            <Card>
              <CardHeader icon="🏆" title="Top 10 Customers" />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">#</th>
                      <th className="pb-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Name</th>
                      <th className="pb-2 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Spent</th>
                      <th className="pb-2 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_customers?.slice(0, 10).map((customer, idx) => (
                      <tr key={`customer-${idx}-${customer.id ?? customer.phone ?? customer.name ?? 'walkin'}`} className="border-b border-slate-50 hover:bg-indigo-50/40 transition-colors group">
                        <td className="py-2 pr-2">
                          <span className="text-[10px] font-black text-slate-300 tabular-nums">{idx + 1}</span>
                        </td>
                        <td className="py-2 text-xs font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">{customer.name}</td>
                        <td className="py-2 text-right text-xs font-black text-indigo-600">₹{parseFloat(customer.total_spent).toFixed(0)}</td>
                        <td className="py-2 text-right">
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">{customer.transactions}</span>
                        </td>
                      </tr>
                    ))}
                    {(!data.top_customers || data.top_customers.length === 0) && (
                      <tr><td colSpan={4}><EmptyState text="No customer data" /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Staff Productivity */}
            <Card>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <CardHeader icon="👨‍💼" title="Staff Productivity" />
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5 ml-6">Live throughput · refreshes every {Math.round(liveRefreshMs / 1000)}s</p>
                </div>
                <div className="shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1 rounded-full ${
                    (data.staff_productivity?.filter(s => s.is_active_now)?.length || 0) > 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    {data.staff_productivity?.filter(s => s.is_active_now)?.length || 0} active
                  </span>
                </div>
              </div>

              {/* Summary pills */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <MiniStat label="Tracked" value={data.staff_productivity?.length || 0} />
                <MiniStat label="Bills" value={data.staff_productivity?.reduce((sum, s) => sum + Number(s.bills_created || 0), 0) || 0} />
                <MiniStat label="Sales" value={`₹${fmt(data.staff_productivity?.reduce((sum, s) => sum + Number(s.sales_value || 0), 0) || 0)}`} />
              </div>

              {/* Search */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[9px] text-slate-400 font-bold shrink-0 tabular-nums">
                  {staffWindow.length}/{data.staff_productivity?.length || 0}
                </span>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none">🔍</span>
                  <input
                    type="search" value={staffQuery}
                    onChange={(e) => setStaffQuery(e.target.value)}
                    placeholder="Search staff by name or ID…"
                    className="w-full text-[11px] border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 font-medium text-slate-900 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none bg-slate-50"
                  />
                </div>
              </div>

              {/* Staff table */}
              <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-100">
                <table className="w-full">
                  <thead className="sticky top-0 z-10 bg-slate-900">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Staff</th>
                      <th className="px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Bills</th>
                      <th className="px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Sales</th>
                      <th className="px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Last</th>
                      <th className="px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">60m</th>
                      <th className="px-3 py-2.5 text-left text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffWindow.map((staff, idx) => (
                      <tr key={`staff-${idx}-${staff.id ?? staff.name ?? 'na'}`} className="border-b border-slate-50 hover:bg-indigo-50/30 transition-colors">
                        <td className="px-3 py-2 text-xs font-bold text-slate-800">{staff.name}</td>
                        <td className="px-3 py-2 text-right text-xs font-black text-slate-700">{staff.bills_created}</td>
                        <td className="px-3 py-2 text-right text-xs font-black text-indigo-600">₹{parseFloat(staff.sales_value).toFixed(0)}</td>
                        <td className="px-3 py-2 text-right text-[10px] text-slate-400 tabular-nums">
                          {staff.last_bill_at ? new Date(staff.last_bill_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-black text-slate-600">{staff.bills_last_hour || 0}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            staff.is_active_now
                              ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            {staff.is_active_now ? 'Active' : 'Idle'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {staffWindow.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-400 font-semibold">
                          No staff matched your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* ── STOCK ALERTS ── */}
          <Card>
            <CardHeader icon="⚠️" title="Stock Alerts" badge={data.stock_alerts?.length} badgeColor="amber" />
            {data.stock_alerts?.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Product</th>
                      <th className="pb-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">SKU</th>
                      <th className="pb-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Stock</th>
                      <th className="pb-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Status</th>
                      <th className="pb-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">30-Day Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stock_alerts.map((item, idx) => (
                      <tr key={`alert-${idx}-${item.id ?? item.sku ?? 'na'}`} className={`border-b border-slate-50 transition-colors ${
                        item.stock_status === 'Out of Stock' ? 'hover:bg-red-50/40' : 'hover:bg-amber-50/40'
                      }`}>
                        <td className="py-2.5 text-xs font-semibold text-slate-800">{item.name}</td>
                        <td className="py-2.5 text-[10px] font-mono font-semibold text-indigo-500">{item.sku}</td>
                        <td className="py-2.5 text-right text-xs font-black text-slate-700">{item.current_stock}</td>
                        <td className="py-2.5">
                          <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            item.stock_status === 'Out of Stock'
                              ? 'bg-red-100 text-red-700 ring-1 ring-red-200'
                              : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                          }`}>
                            {item.stock_status}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-xs font-semibold text-slate-600">{item.last_30days_sales}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 py-4 text-xs font-semibold text-emerald-600">
                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-sm">✓</span>
                All products are well-stocked. No alerts.
              </div>
            )}
          </Card>

          {/* ── PRODUCT MOVEMENT ── */}
          <Card>
            <CardHeader icon="🚀" title="Product Movement Analysis" />
            {data.moving_items?.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Product</th>
                      <th className="pb-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">SKU</th>
                      <th className="pb-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Qty Sold</th>
                      <th className="pb-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Revenue</th>
                      <th className="pb-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.moving_items.slice(0, 20).map((item, idx) => (
                      <tr key={`moving-${idx}-${item.id ?? item.sku ?? 'na'}`} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 text-xs font-semibold text-slate-800">{item.name}</td>
                        <td className="py-2.5 text-[10px] font-mono font-semibold text-indigo-500">{item.sku}</td>
                        <td className="py-2.5 text-right text-xs font-bold text-slate-700">{item.quantity_sold}</td>
                        <td className="py-2.5 text-right text-xs font-black text-indigo-600">₹{parseFloat(item.revenue).toFixed(0)}</td>
                        <td className="py-2.5">
                          <span className={`text-[9px] font-black uppercase tracking-wide px-2.5 py-0.5 rounded-full ${
                            item.movement_category === 'Fast-Moving'
                              ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                              : item.movement_category === 'Medium-Moving'
                              ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                              : 'bg-red-100 text-red-700 ring-1 ring-red-200'
                          }`}>
                            {item.movement_category}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState text="No movement data available" />}
          </Card>

        </div>
      </div>
    </MainLayout>
  );
}

// ─────────────────────────────────────────
// HELPER COMPONENTS
// ─────────────────────────────────────────

const accentConfig = {
  indigo: { bg: 'bg-indigo-50',  ring: 'ring-indigo-100', iconBg: 'bg-indigo-100',  val: 'text-indigo-700' },
  emerald:{ bg: 'bg-emerald-50', ring: 'ring-emerald-100',iconBg: 'bg-emerald-100', val: 'text-emerald-700' },
  violet: { bg: 'bg-violet-50',  ring: 'ring-violet-100', iconBg: 'bg-violet-100',  val: 'text-violet-700' },
  amber:  { bg: 'bg-amber-50',   ring: 'ring-amber-100',  iconBg: 'bg-amber-100',   val: 'text-amber-700'  },
};

function KPICard({ title, value, subtitle, icon, accent = 'indigo' }) {
  const a = accentConfig[accent] || accentConfig.indigo;
  return (
    <div className={`${a.bg} ring-1 ${a.ring} rounded-2xl p-4 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-default`}>
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400 leading-tight">{title}</span>
        <span className={`w-7 h-7 rounded-lg ${a.iconBg} flex items-center justify-center text-sm shrink-0`}>{icon}</span>
      </div>
      <p className={`text-2xl font-black tracking-tight ${a.val} leading-none`}>{value}</p>
      <p className="text-[10px] font-semibold text-slate-500 mt-1.5">{subtitle}</p>
    </div>
  );
}

function Card({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      {children}
    </div>
  );
}

function CardHeader({ icon, title, badge, badgeColor = 'slate' }) {
  const badgeColors = {
    amber: 'bg-amber-100 text-amber-700',
    red:   'bg-red-100 text-red-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <h3 className="text-sm font-black text-slate-800 tracking-tight">{title}</h3>
      </div>
      {badge != null && badge > 0 && (
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${badgeColors[badgeColor] || badgeColors.slate}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

function StatRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between rounded-xl px-3 py-2 bg-slate-50 hover:bg-slate-100/60 transition-colors">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <span className={`text-sm font-black ${highlight ? 'text-indigo-600' : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2 text-center">
      <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 truncate">{label}</p>
      <p className="text-xs font-black text-slate-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex items-center justify-center py-8 text-xs font-semibold text-slate-400 gap-2">
      <span>—</span>{text}
    </div>
  );
}

function getPastDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
