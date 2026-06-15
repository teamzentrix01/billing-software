'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * SalesOrderListPage — shared layout for all Sales Order pages.
 *
 * Props:
 *  breadcrumbs      [{ label, href? }]
 *  title            string
 *  description      string
 *  columns          [{ key, label }]
 *  rows             array of objects
 *  onFetch          ({ dateRange, stores }) => void
 *  totalLabel       string    e.g. "Results"
 *  emptyMessage     string
 *  bulkOperations   [string]  dropdown items  (default shown)
 *  showBulkOps      boolean   hide button if false
 */
export default function SalesOrderListPage({
  breadcrumbs    = [],
  title          = '',
  description    = '',
  columns        = [],
  rows           = [],
  onFetch,
  onBulkOperation,
  onDownload,
  totalLabel     = 'Results',
  emptyMessage   = 'No matching record found',
  bulkOperations = ['Create Invoice', 'Write Off', 'Export'],
  showBulkOps    = true,
  storeOptions   = [{ value: 'all', label: 'All Regions & Stores' }],
  loading        = false,
  showViewAction = false,
}) {
  /* ── date helper ── */
  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
  const normalizedStoreOptions = useMemo(() => {
    return Array.isArray(storeOptions) && storeOptions.length > 0
      ? storeOptions
      : [{ value: 'all', label: 'All Regions & Stores' }];
  }, [storeOptions]);

  /* ── state ── */
  const [startDate,    setStartDate]    = useState(todayIso);
  const [endDate,      setEndDate]      = useState(todayIso);
  const [storeLabel,   setStoreLabel]   = useState(normalizedStoreOptions[0]?.value || 'all');
  const [search,       setSearch]       = useState('');
  const [pageSize,     setPageSize]     = useState(10);
  const [checkedRows,  setCheckedRows]  = useState([]);
  const [allChecked,   setAllChecked]   = useState(false);
  const [bulkOpen,     setBulkOpen]     = useState(false);
  const bulkRef = useRef(null);

  useEffect(() => {
    if (!normalizedStoreOptions.some((option) => option.value === storeLabel)) {
      setStoreLabel(normalizedStoreOptions[0]?.value || 'all');
    }
  }, [normalizedStoreOptions, storeLabel]);

  /* close bulk dropdown on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (bulkRef.current && !bulkRef.current.contains(e.target)) setBulkOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── handlers ── */
  const validateDateRange = () => {
    if (startDate && endDate && startDate > endDate) {
      alert('Start date cannot be later than end date');
      return false;
    }

    return true;
  };

  const getDateRange = () => `${startDate} - ${endDate}`;

  const handleFetch = () => {
    if (!validateDateRange()) return;
    onFetch?.({ dateRange: getDateRange(), stores: storeLabel });
  };

  const handleBulkOperation = (operation) => {
    if (!validateDateRange()) return;

    const selectedRows = rows.filter((row) => checkedRows.includes(row.id));

    if (selectedRows.length === 0) {
      alert('Please select at least one record');
      return;
    }

    onBulkOperation?.({
      operation,
      selectedRows,
      selectedRowIds: checkedRows,
      dateRange: getDateRange(),
      stores: storeLabel,
    });

    setBulkOpen(false);
  };

  const handleDownload = () => {
    onDownload?.(filtered);
  };

  const handleAllCheck = () => {
    const visibleRows = filtered.slice(0, pageSize);

    if (allChecked) { setCheckedRows([]); setAllChecked(false); }
    else            { setCheckedRows(visibleRows.map((r) => r.id)); setAllChecked(true); }
  };

  const handleRowCheck = (id) =>
    setCheckedRows((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );

  const filtered = rows.filter((row) =>
    Object.values(row).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase())
    )
  );

  /* ── pagination slice ── */
  const totalCount  = filtered.length;
  const startIndex  = totalCount === 0 ? 0 : 1;
  const endIndex    = Math.min(pageSize, totalCount);

  /* ────────────────────────── RENDER ────────────────────────── */
  return (
    <MainLayout>
    <div className="min-h-screen bg-[#f5f6fa] font-sans text-sm text-gray-800">

      <div className="p-6">

        {/* ── Breadcrumb ── */}
        <nav className="flex items-center gap-1 text-xs mb-4">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-400 mx-0.5">›</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="text-blue-500 hover:underline font-medium">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-blue-500 font-semibold">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-[22px] font-bold text-gray-900 leading-tight">{title}</h1>
            {description && (
              <p className="text-xs text-gray-400 mt-0.5">{description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                fill="none" viewBox="0 0 20 20"
              >
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M15 15l-3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-[7px] w-56 border border-gray-200 rounded-md text-xs bg-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
              />
            </div>

            {/* Bulk Operations */}
            {showBulkOps && (
              <div className="relative" ref={bulkRef}>
                <button
                  onClick={() => setBulkOpen((o) => !o)}
                  className="flex items-center gap-1.5 px-4 py-[7px] border border-[#B00000] text-[#B00000] bg-white rounded-md text-xs font-semibold hover:bg-blue-50 transition shadow-sm"
                >
                  Bulk Operations
                  <svg
                    className={`w-3 h-3 transition-transform ${bulkOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 12 12" fill="none"
                  >
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
                {bulkOpen && (
                  <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
                    {bulkOperations.map((op) => (
                      <button
                        key={op}
                        onClick={() => handleBulkOperation(op)}
                        className="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 transition"
                      >
                        {op}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Filter card ── */}
        <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 mb-4 shadow-sm">
          <div className="flex items-end gap-4 flex-wrap">

            {/* Date Range */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Date Range</p>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-36 border border-gray-300 rounded-md px-3 py-[7px] text-xs bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <span className="text-gray-400 text-xs">to</span>
                <div className="relative">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-36 border border-gray-300 rounded-md px-3 py-[7px] text-xs bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>
            </div>

            {/* Regions & Stores */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Regions &amp; Stores</p>
              <div className="relative">
                <select
                  value={storeLabel}
                  onChange={(e) => setStoreLabel(e.target.value)}
                  className="w-48 appearance-none border border-gray-300 rounded-md px-3 py-[7px] pr-8 bg-white text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {normalizedStoreOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </span>
              </div>
            </div>

            {/* Fetch button */}
            <button
              onClick={handleFetch}
              disabled={loading}
              className="px-6 py-[7px] bg-[#B00000] hover:bg-[#920000] active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 text-white text-xs font-semibold rounded-md transition shadow-sm"
            >
              {loading ? 'Loading…' : 'Fetch'}
            </button>

            {/* Download icon — pushed to far right */}
            <div className="ml-auto">
              <button
                onClick={handleDownload}
                className="p-[7px] border border-gray-300 rounded-md bg-white hover:bg-gray-50 transition shadow-sm text-gray-500"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5M4 17h12"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

          </div>
        </div>

        {/* ── Table card ── */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-white">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={handleAllCheck}
                      className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer"
                    />
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                  {showViewAction && (
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">
                      Action
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 1 + (showViewAction ? 1 : 0)}
                      className="text-center text-gray-400 py-16 text-xs"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, pageSize).map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-gray-50 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={checkedRows.includes(row.id)}
                          onChange={() => handleRowCheck(row.id)}
                          className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer"
                        />
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {row[col.key] ?? '-'}
                        </td>
                      ))}
                      {showViewAction && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.publicToken ? (
                            <Link
                              href={`/invoice/${row.publicToken}`}
                              className="inline-flex items-center rounded-md border border-[#B00000] px-3 py-1.5 text-[11px] font-semibold text-[#B00000] transition hover:bg-[#B00000] hover:text-white"
                            >
                              View
                            </Link>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pagination ── */}
        <div className="flex items-center gap-3 mt-4">
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="appearance-none border border-gray-300 rounded-md px-3 py-1.5 pr-7 bg-white text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
          </div>
          <span className="text-gray-400 text-xs">
            Showing {totalCount === 0 ? 0 : startIndex} to {totalCount === 0 ? 0 : endIndex} of {totalCount} {totalLabel}
          </span>
        </div>

      </div>
    </div>
    </MainLayout>
  );
}
