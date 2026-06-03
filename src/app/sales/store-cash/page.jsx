'use client';

import { useEffect, useState } from 'react';
import MainLayout from '@/components/MainLayout';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function typeLabel(type) {
  const labels = {
    cash_sale: 'Cash Sale',
    session_close: 'Session Close',
    opening_float: 'Opening Float',
    handover_verified: 'Handover Verified',
    withdrawal: 'Withdrawal',
    manual_add: 'Manual Add',
  };
  return labels[type] || String(type || '-').replace(/_/g, ' ');
}

function StatCard({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    red: 'border-rose-200 bg-rose-50 text-rose-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
  };

  return (
    <div className={`rounded-lg border p-4 ${tones[tone] || tones.slate}`}>
      <p className="text-[11px] font-black uppercase tracking-widest opacity-60">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

export default function StoreCashPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingId, setVerifyingId] = useState(null);
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [receivedAmounts, setReceivedAmounts] = useState({});
  const [form, setForm] = useState({
    amount: '',
    transactionDate: new Date().toISOString().slice(0, 10),
    takenBy: '',
    remarks: '',
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  async function loadCash({ silent = false, showErrors = true } = {}) {
    if (silent) {
      setRefreshing(true);
    } else if (!data) {
      setInitialLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const res = await fetch('/api/store-cash', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        if (!silent) setData(null);
        if (showErrors) showToast(json.message || 'Failed to load store cash', 'error');
      }
    } catch {
      if (!silent) setData(null);
      if (showErrors) showToast('Failed to load store cash', 'error');
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadCash();
    const timer = setInterval(() => {
      loadCash({ silent: true, showErrors: false });
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  async function submitWithdrawal(e) {
    e.preventDefault();
    const amount = toNumber(form.amount);
    if (amount <= 0) {
      showToast('Enter a valid withdrawal amount', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/store-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setForm({
          amount: '',
          transactionDate: new Date().toISOString().slice(0, 10),
          takenBy: '',
          remarks: '',
        });
        showToast('Cash withdrawal recorded');
        await loadCash({ silent: true });
      } else {
        showToast(json.message || 'Failed to record withdrawal', 'error');
      }
    } catch {
      showToast('Failed to record withdrawal', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyHandover(handover) {
    const receivedAmount = toNumber(receivedAmounts[handover.id] ?? handover.handoverAmount);
    if (receivedAmount <= 0) {
      showToast('Enter received cash amount', 'error');
      return;
    }

    setVerifyingId(handover.id);
    try {
      const res = await fetch('/api/store-cash', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closingId: handover.id,
          receivedAmount,
          remarks: `Verified handover for ${handover.userName || handover.sessionId}`,
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message || 'Cash handover verified');
        setReceivedAmounts((current) => {
          const next = { ...current };
          delete next[handover.id];
          return next;
        });
        await loadCash({ silent: true });
      } else {
        showToast(json.message || 'Failed to verify handover', 'error');
      }
    } catch {
      showToast('Failed to verify handover', 'error');
    } finally {
      setVerifyingId(null);
    }
  }

  const summary = data?.summary || {};
  const activeSessions = Array.isArray(data?.activeSessions?.sessions) ? data.activeSessions.sessions : [];
  const pendingHandovers = Array.isArray(data?.pendingHandovers) ? data.pendingHandovers : [];
  const currentEmployee = data?.activeSessions?.currentEmployee || null;
  const ledger = Array.isArray(data?.ledger) ? data.ledger : [];

  return (
    <MainLayout>
      <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
        {toast && (
          <div className={`fixed right-4 top-4 z-[1000] rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${
            toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
          }`}>
            {toast.msg}
          </div>
        )}

        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Sales</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">Store Cash Tracking</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {data?.store?.name ? `Store: ${data.store.name}` : 'Cash balance for your assigned store'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadCash({ silent: true })}
              disabled={refreshing}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {initialLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
              Loading store cash...
            </div>
          ) : data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <StatCard label="Current Cash" value={formatCurrency(summary.currentCash)} tone="green" />
                <StatCard label="Final Store Cash" value={formatCurrency(summary.finalCash)} />
                <StatCard label="Active Session Cash" value={formatCurrency(summary.activeSessionCash)} tone="blue" />
                <StatCard label="Pending Handover" value={formatCurrency(summary.pendingHandoverCash)} tone="red" />
                <StatCard label="My Drawer Cash" value={formatCurrency(currentEmployee?.expectedCash || 0)} tone="green" />
                <StatCard label="Today Cash Sale" value={formatCurrency(summary.todayCashSales)} tone="blue" />
                <StatCard label="Week Cash Sale" value={formatCurrency(summary.weekCashSales)} />
                <StatCard label="Month Cash Sale" value={formatCurrency(summary.monthCashSales)} />
                <StatCard label="Month Withdrawn" value={formatCurrency(summary.monthWithdrawals)} tone="red" />
              </div>

              <div className="mt-6 rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-base font-black text-slate-950">Active Employee Cash</h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Open POS sessions are included in Current Cash. Final Store Cash updates after manager verification.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Employee</th>
                        <th className="px-4 py-3">Counter</th>
                        <th className="px-4 py-3">Opened</th>
                        <th className="px-4 py-3">Bills</th>
                          <th className="px-4 py-3">Cash Sale</th>
                          <th className="px-4 py-3">Opening Float</th>
                          <th className="px-4 py-3">Expected Cash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeSessions.length ? activeSessions.map((session) => (
                        <tr key={session.sessionId} className={session.isCurrentUser ? 'bg-emerald-50/50 text-slate-800' : 'text-slate-700'}>
                          <td className="whitespace-nowrap px-4 py-3 font-bold">
                            {session.userName || `User ${session.userId}`}{session.isCurrentUser ? ' (You)' : ''}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">{session.counterName || '-'}</td>
                          <td className="whitespace-nowrap px-4 py-3">{formatDate(session.startedAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{session.billCount || 0}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-bold text-emerald-700">{formatCurrency(session.cashSales)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{formatCurrency(session.openingCash)}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-bold">{formatCurrency(session.expectedCash)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan="7" className="px-4 py-6 text-center text-sm font-semibold text-slate-400">
                            No open employee sessions.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-base font-black text-slate-950">Pending Cash Handovers</h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Closed sessions stay here until manager verifies received cash.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Employee</th>
                        <th className="px-4 py-3">Closed</th>
                        <th className="px-4 py-3">Expected</th>
                        <th className="px-4 py-3">Counted</th>
                        <th className="px-4 py-3">Variance</th>
                        <th className="px-4 py-3">Received</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pendingHandovers.length ? pendingHandovers.map((handover) => (
                        <tr key={handover.id} className="text-slate-700">
                          <td className="whitespace-nowrap px-4 py-3 font-bold">{handover.userName || `User ${handover.userId}`}</td>
                          <td className="whitespace-nowrap px-4 py-3">{formatDate(handover.closedAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{formatCurrency(handover.expectedCash)}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-bold">{formatCurrency(handover.handoverAmount)}</td>
                          <td className={`whitespace-nowrap px-4 py-3 font-bold ${Math.abs(toNumber(handover.variance)) > 0.01 ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {formatCurrency(handover.variance)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={receivedAmounts[handover.id] ?? handover.handoverAmount ?? ''}
                              onChange={(e) => setReceivedAmounts((current) => ({ ...current, [handover.id]: e.target.value }))}
                              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 capitalize">{String(handover.handoverStatus || '').replace(/_/g, ' ')}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <button
                              type="button"
                              onClick={() => verifyHandover(handover)}
                              disabled={verifyingId === handover.id}
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              {verifyingId === handover.id ? 'Verifying...' : 'Verify'}
                            </button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan="8" className="px-4 py-6 text-center text-sm font-semibold text-slate-400">
                            No pending cash handovers.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
                <form onSubmit={submitWithdrawal} className="rounded-lg border border-slate-200 bg-white p-5">
                  <h2 className="text-base font-black text-slate-950">Withdraw Cash</h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Withdrawal will reduce the store balance used for the next POS session.
                  </p>

                  <div className="mt-5 space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold text-slate-600">Amount</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.amount}
                        onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                        placeholder="Enter amount"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold text-slate-600">Withdrawal Date</span>
                      <input
                        type="date"
                        value={form.transactionDate}
                        onChange={(e) => setForm((current) => ({ ...current, transactionDate: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold text-slate-600">Taken By</span>
                      <input
                        type="text"
                        value={form.takenBy}
                        onChange={(e) => setForm((current) => ({ ...current, takenBy: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                        placeholder="Owner / manager name"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold text-slate-600">Remarks</span>
                      <textarea
                        rows="3"
                        value={form.remarks}
                        onChange={(e) => setForm((current) => ({ ...current, remarks: e.target.value }))}
                        className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                        placeholder="Optional note"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-black text-white hover:bg-rose-500 disabled:opacity-50"
                    >
                      {submitting ? 'Saving...' : 'Record Withdrawal'}
                    </button>
                  </div>
                </form>

                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-5 py-4">
                    <h2 className="text-base font-black text-slate-950">Cash Ledger</h2>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Cash sales are grouped by day. Opening floats, withdrawals, and verified handovers are shown as ledger entries.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">In</th>
                          <th className="px-4 py-3">Out</th>
                          <th className="px-4 py-3">Balance</th>
                          <th className="px-4 py-3">Remarks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledger.length ? ledger.map((row, index) => (
                          <tr key={`${row.type}-${row.date}-${index}`} className="text-slate-700">
                            <td className="whitespace-nowrap px-4 py-3 font-semibold">{formatDate(row.date)}</td>
                            <td className="whitespace-nowrap px-4 py-3">{typeLabel(row.type)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-emerald-700">
                              {row.direction === 'in' ? formatCurrency(row.amount) : '-'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-rose-700">
                              {row.direction === 'out' ? formatCurrency(row.amount) : '-'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-bold">
                              {row.balanceAfter == null ? '-' : formatCurrency(row.balanceAfter)}
                            </td>
                            <td className="min-w-[220px] px-4 py-3 text-slate-500">{row.remarks || '-'}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="6" className="px-4 py-8 text-center text-sm font-semibold text-slate-400">
                              No cash ledger entries yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700">
              Open a POS session for your store before using cash tracking.
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
