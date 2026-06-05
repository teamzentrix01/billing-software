'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import { fetchLookup, normalizeVendors } from '@/lib/purchaseLookups';
import { formatIndianDate } from '@/lib/dateUtils';

const tableHeaders = [
  'Invoice ID',
  'Invoice Number',
  'Vendor Name',
  'PO ID',
  'Total Amount',
  'Amount Paid',
  'Amount Left',
  'Invoice Creation Date',
  'Due Date',
  'Created by',
  'Remarks',
  'Status',
  'Actions',
];

function formatDate(value) {
  return formatIndianDate(value, '—');
}

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function mapRecordsToTable(records) {
  return (records || []).map((row) => ({
    'Invoice ID': row.transactionId ? `#${row.transactionId}` : `#INV-${String(row.id).padStart(4, '0')}`,
    'Invoice Number': row.invoiceNumber || '—',
    'Vendor Name': row.vendorName || '—',
    'PO ID': row.poId ? `#${row.poId}` : '—',
    'Total Amount': formatCurrency(row.totalAmount),
    'Amount Paid': formatCurrency(row.amountPaid),
    'Amount Left': formatCurrency(row.amountLeft),
    'Invoice Creation Date': formatDate(row.invoiceDate || row.createdAt),
    'Due Date': formatDate(row.dueDate),
    'Created by': row.createdBy || 'System',
    'Remarks': row.remarks || '—',
    'Status': row.status || 'Pending',
  }));
}

async function fetchVendorInvoices() {
  const res = await fetch('/api/vendor-invoices', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch vendor invoices');
  return res.json();
}

async function settleVendorInvoice(payload) {
  const res = await fetch('/api/vendor-invoices', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to settle invoice');
  return data;
}

function exportCsv(rows) {
  const headers = tableHeaders.filter((header) => header !== 'Actions');
  const csv = [
    headers.join(','),
    ...mapRecordsToTable(rows).map((row) => headers.map((header) => `"${String(row[header] || '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vendor-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function VendorInvoicesPage() {
  const router = useRouter();
  const [records, setRecords] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [settlement, setSettlement] = useState({
    amount: '',
    paymentMode: 'Cash',
    referenceNo: '',
    settlementDate: new Date().toISOString().slice(0, 10),
    remarks: '',
  });
  const [savingSettlement, setSavingSettlement] = useState(false);

  const loadData = () => {
    setLoading(true);
    setError('');
    Promise.allSettled([fetchVendorInvoices(), fetchLookup('/api/vendors')])
      .then(([invoiceResult, vendorResult]) => {
        if (invoiceResult.status === 'fulfilled') {
          setRecords(Array.isArray(invoiceResult.value) ? invoiceResult.value : []);
        } else {
          setError(invoiceResult.reason?.message || 'Failed to load vendor invoices');
          setRecords([]);
        }

        if (vendorResult.status === 'fulfilled') {
          setVendors(normalizeVendors(vendorResult.value));
        } else {
          setError((current) => current || vendorResult.reason?.message || 'Failed to load vendors');
          setVendors([]);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((row) => {
      const vendorMatch = vendorFilter === 'all' || String(row.vendorId) === String(vendorFilter);
      const statusMatch = statusFilter === 'all' || String(row.status || '').toLowerCase() === statusFilter.toLowerCase();
      const searchMatch = !q || [row.transactionId, row.invoiceNumber, row.vendorName, row.status, row.remarks]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
      return vendorMatch && statusMatch && searchMatch;
    });
  }, [records, search, vendorFilter, statusFilter]);

  const tableData = useMemo(() => mapRecordsToTable(filteredRecords), [filteredRecords]);

  const openSettlement = (invoice) => {
    setActiveInvoice(invoice);
    setSettlement({
      amount: invoice.amountLeft ? String(invoice.amountLeft) : '',
      paymentMode: 'Cash',
      referenceNo: '',
      settlementDate: new Date().toISOString().slice(0, 10),
      remarks: '',
    });
  };

  const submitSettlement = async () => {
    if (!activeInvoice) return;
    const amount = Number(settlement.amount || 0);
    if (!amount || amount <= 0) return alert('Enter payment amount');
    setSavingSettlement(true);
    try {
      await settleVendorInvoice({
        invoiceId: activeInvoice.id,
        ...settlement,
        amount,
      });
      setActiveInvoice(null);
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to settle invoice');
    } finally {
      setSavingSettlement(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Purchase</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Vendor Invoices</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">List of all invoices</h1>
          <p className="text-[12.5px] text-gray-400 mt-1">List of all invoices Need Help?</p>
        </div>

        <button
          onClick={() => router.push('/purchase/vendor-invoices/create')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-[13px] font-medium text-white hover:bg-blue-700 transition-colors flex-shrink-0"
        >
          <i className="ti ti-plus text-[16px]" />
          Create Invoice
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Vendor:</label>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
            >
              <option value="all">ALL</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Invoice Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 justify-between flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[340px] bg-gray-50 rounded-lg px-3 py-2">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
          <button onClick={() => exportCsv(filteredRecords)} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors" title="Download CSV">
            <i className="ti ti-download text-gray-500 text-[16px]" />
          </button>
        </div>
        {error && (
          <div className="px-4 py-3 border-b border-red-100 bg-red-50 text-[12px] font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr className="border-b border-gray-100">
                {tableHeaders.map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-[14px] text-gray-500">
                    Loading records...
                  </td>
                </tr>
              ) : tableData.length > 0 ? (
                tableData.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
                    {tableHeaders.map((header, colIdx) => (
                      <td key={colIdx} className="px-4 py-3 text-[13px] text-gray-700">
                        {header === 'Actions' ? (
                          <button
                            onClick={() => openSettlement(filteredRecords[rowIdx])}
                            disabled={Number(filteredRecords[rowIdx]?.amountLeft || 0) <= 0}
                            className="rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-50 disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white"
                          >
                            Settle
                          </button>
                        ) : header === 'Status' ? (
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                            String(row[header]).toLowerCase() === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : String(row[header]).toLowerCase() === 'partial'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}>
                            {row[header] || '-'}
                          </span>
                        ) : (
                          row[header] || '-'
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-[14px] text-blue-700 font-medium">
                    No Records Found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-400">
          <select className="border border-gray-200 rounded-lg px-3 py-2 bg-white text-[12px] text-gray-600">
            <option>10</option>
            <option>20</option>
            <option>50</option>
          </select>
          <span>Showing {tableData.length} Results</span>
        </div>
      </div>

      {activeInvoice && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-[16px] font-bold text-gray-900">Settle Vendor Invoice</h3>
                <p className="mt-1 text-[12px] text-gray-500">
                  {activeInvoice.invoiceNumber} · Balance {formatCurrency(activeInvoice.amountLeft)}
                </p>
              </div>
              <button onClick={() => setActiveInvoice(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600">Close</button>
            </div>
            <div className="grid grid-cols-2 gap-4 p-5">
              <div>
                <label className="text-[12px] font-medium text-gray-700">Amount *</label>
                <input type="number" min="0" step="0.01" value={settlement.amount} onChange={(e) => setSettlement({ ...settlement, amount: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Payment Mode</label>
                <select value={settlement.paymentMode} onChange={(e) => setSettlement({ ...settlement, paymentMode: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white">
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                  <option>Bank Transfer</option>
                  <option>Cheque</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Reference No.</label>
                <input value={settlement.referenceNo} onChange={(e) => setSettlement({ ...settlement, referenceNo: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Payment Date</label>
                <input type="date" value={settlement.settlementDate} onChange={(e) => setSettlement({ ...settlement, settlementDate: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
              <div className="col-span-2">
                <label className="text-[12px] font-medium text-gray-700">Remarks</label>
                <textarea rows={3} value={settlement.remarks} onChange={(e) => setSettlement({ ...settlement, remarks: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
            </div>
            {activeInvoice.payments?.length > 0 && (
              <div className="mx-5 mb-4 rounded-lg border border-gray-200">
                <div className="border-b border-gray-100 px-3 py-2 text-[12px] font-bold text-gray-700">Payment History</div>
                <div className="max-h-40 overflow-auto divide-y divide-gray-100">
                  {activeInvoice.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between px-3 py-2 text-[12px] text-gray-600">
                      <span>{formatDate(payment.settlementDate)} · {payment.paymentMode}{payment.referenceNo ? ` · ${payment.referenceNo}` : ''}</span>
                      <strong className="text-gray-900">{formatCurrency(payment.amount)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button onClick={() => setActiveInvoice(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Cancel</button>
              <button onClick={submitSettlement} disabled={savingSettlement} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {savingSettlement ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
