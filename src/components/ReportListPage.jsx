'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MainLayout from '@/components/MainLayout';

const PAGE_SIZES = [10, 25, 50, 100];
const EMPTY_ARRAY = [];
const MONTHS = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function optionListsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.value === b[index]?.value && item.label === b[index]?.label);
}

function getTodayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value) {
  if (!value) return '';
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return text;

  const displayMatch = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (displayMatch) {
    const month = MONTHS[displayMatch[2].toLowerCase()];
    if (month) return `${displayMatch[3]}-${month}-${displayMatch[1].padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}

function parseDateRangeInput(value) {
  const today = getTodayInputValue();
  if (!value) return { from: today, to: today };

  const parts = String(value).split(/\s+-\s+/);
  const from = parseDateInputValue(parts[0]) || today;
  const to = parseDateInputValue(parts[1] || parts[0]) || from;
  return from <= to ? { from, to } : { from: to, to: from };
}

function formatDateForReport(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateRangeForReport(from, to) {
  const safeFrom = parseDateInputValue(from) || getTodayInputValue();
  const safeTo = parseDateInputValue(to) || safeFrom;
  const ordered = safeFrom <= safeTo ? [safeFrom, safeTo] : [safeTo, safeFrom];
  return `${formatDateForReport(ordered[0])} - ${formatDateForReport(ordered[1])}`;
}

function DateRangeFilter({ value, onChange }) {
  const wrapperRef = useRef(null);
  const fromInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const range = useMemo(() => parseDateRangeInput(value), [value]);

  useEffect(() => {
    if (!open) return undefined;

    const timer = window.setTimeout(() => {
      fromInputRef.current?.focus();
      try {
        fromInputRef.current?.showPicker?.();
      } catch {
        // Some browsers only allow showPicker during the original click gesture.
      }
    }, 0);

    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const updateRange = (nextPart) => {
    const nextFrom = nextPart.from || range.from;
    const nextTo = nextPart.to || range.to;
    onChange(formatDateRangeForReport(nextFrom, nextTo));
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <span className="min-w-0 truncate">{value || formatDateRangeForReport(range.from, range.to)}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 8h14M7 2v3M13 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-full min-w-[18rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">From</span>
              <input
                ref={fromInputRef}
                type="date"
                value={range.from}
                onChange={(event) => updateRange({ from: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">To</span>
              <input
                type="date"
                value={range.to}
                onChange={(event) => updateRange({ to: event.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ReportsListPage — shared layout for all individual report pages.
 *
 * Props:
 *  breadcrumbs   [{ label, href? }]
 *  title         string
 *  description   string
 *  filters       [{ key, label, type: 'date-range'|'select'|'text', options?: [] }]
 *  columns       [{ key, label }]
 *  rows          array of objects
 *  onApply       (filterValues) => void
 *  totalLabel    string
 *  emptyMessage  string
 *  extraActions  ReactNode   — e.g. "Convert B2B to B2C" button
 */
export default function ReportsListPage({
  breadcrumbs  = EMPTY_ARRAY,
  title        = '',
  description  = '',
  filters      = EMPTY_ARRAY,
  columns      = EMPTY_ARRAY,
  rows         = EMPTY_ARRAY,
  reportKey    = '',
  apiPath      = '',
  onApply,
  totalLabel   = 'Results',
  emptyMessage = 'No Rows To Show',
  extraActions = null,
}) {
  const pathname = usePathname();
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const todayStr = `${today} - ${today}`;

  const [regionOptions, setRegionOptions] = useState([]);
  const [storeOptions, setStoreOptions] = useState([]);
  const [remoteRows, setRemoteRows] = useState(EMPTY_ARRAY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const filterSignature = useMemo(
    () => filters.map((filter) => `${filter.key}:${filter.label}:${filter.type}`).join('|'),
    [filters]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFilterOptions() {
      const hasRegionFilter = filters.some((filter) => filter.key === 'region' || /region/i.test(filter.label || ''));
      const hasStoreFilter = filters.some((filter) => filter.key === 'store' || /store/i.test(filter.label || ''));

      try {
        if (hasRegionFilter) {
          const res = await fetch('/api/regions', { cache: 'no-store', credentials: 'include' });
          const json = await res.json().catch(() => ({}));

          if (res.ok && json?.success && !cancelled) {
            const records = Array.isArray(json?.data?.records) ? json.data.records : [];
            const nextOptions = records.map((region) => ({ value: String(region.id), label: region.name }));
            setRegionOptions((prev) => optionListsEqual(prev, nextOptions) ? prev : nextOptions);
          }
        }

        if (hasStoreFilter) {
          const res = await fetch('/api/reports/dashboard', { cache: 'no-store', credentials: 'include' });
          const json = await res.json().catch(() => ({}));

          if (res.ok && json?.success && !cancelled) {
            const stores = Array.isArray(json?.data?.stores) ? json.data.stores : [];
            const nextOptions = stores.map((store) => ({ value: String(store.id), label: store.name }));
            setStoreOptions((prev) => optionListsEqual(prev, nextOptions) ? prev : nextOptions);
          }
        }
      } catch (err) {
        console.error('[ReportListPage] Failed to fetch filter options', err);
        if (!cancelled) {
          setRegionOptions([]);
          setStoreOptions([]);
        }
      }
    }

    loadFilterOptions();
    return () => {
      cancelled = true;
    };
  }, [filterSignature]);

  const resolvedFilters = useMemo(
    () => filters.map((filter) => {
      const isRegionFilter = filter.key === 'region' || /region/i.test(filter.label || '');
      if (!isRegionFilter) return filter;

      return {
        ...filter,
        type: 'select',
        options: regionOptions.length > 0
          ? [{ value: 'all', label: 'All Regions' }, ...regionOptions]
          : (Array.isArray(filter.options) ? filter.options : []),
      };
    }),
    [filters, regionOptions]
  );

  const resolvedFiltersWithStores = useMemo(
    () => resolvedFilters.map((filter) => {
      const isStoreFilter = filter.key === 'store' || /store/i.test(filter.label || '');
      if (!isStoreFilter) return filter;

      return {
        ...filter,
        type: 'select',
        options: storeOptions.length > 0
          ? [{ value: 'all', label: 'All Stores' }, ...storeOptions]
          : (Array.isArray(filter.options) ? filter.options : []),
      };
    }),
    [resolvedFilters, storeOptions]
  );

  const defaultFilterValues = useMemo(() => {
    const v = {};
    resolvedFiltersWithStores.forEach((f) => {
      if (f.type === 'date-range' || f.type === 'daterange') v[f.key] = todayStr;
      else v[f.key] = '';
    });
    return v;
  }, [resolvedFiltersWithStores, todayStr]);

  const [filterValues, setFilterValues] = useState(defaultFilterValues);
  const [search,       setSearch]       = useState('');
  const [pageSize,     setPageSize]     = useState(10);
  const [checkedRows,  setCheckedRows]  = useState([]);
  const [allChecked,   setAllChecked]   = useState(false);

  const set = (key, val) => setFilterValues((prev) => ({ ...prev, [key]: val }));

  const inferredReportKey = useMemo(() => {
    if (reportKey) return reportKey;
    const prefix = '/reports/';
    if (!pathname?.startsWith(prefix)) return '';
    return pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');
  }, [pathname, reportKey]);

  const effectiveApiPath = apiPath || (inferredReportKey ? `/api/reports/${inferredReportKey}` : '');

  const buildQuery = (values, extra = {}) => {
    const params = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (!value || value === 'all' || value === 'All' || value === 'Select' || value === 'Select...') return;
      params.set(key, value);
    });
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    return params.toString();
  };

  const fetchReportRows = async (values = filterValues) => {
    if (!effectiveApiPath) return;
    setLoading(true);
    setError('');

    try {
      const queryString = buildQuery(values);
      const res = await fetch(`${effectiveApiPath}${queryString ? `?${queryString}` : ''}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Unable to load report');
      }

      setRemoteRows(Array.isArray(json?.data?.rows) ? json.data.rows : []);
    } catch (err) {
      console.error('[ReportListPage] report fetch failed', err);
      setError(err.message || 'Unable to load report');
      setRemoteRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportRows(defaultFilterValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveApiPath]);

  const handleApply = () => {
    onApply?.(filterValues);
    fetchReportRows(filterValues);
  };

  const handleDownload = () => {
    if (!effectiveApiPath) return;
    const queryString = buildQuery(filterValues, { export: 'xlsx', columns: JSON.stringify(columns) });
    window.location.href = `${effectiveApiPath}?${queryString}`;
  };

  const handleAllCheck = () => {
    if (allChecked) { setCheckedRows([]); setAllChecked(false); }
    else { setCheckedRows(effectiveRows.map((r) => r.id)); setAllChecked(true); }
  };

  const effectiveRows = remoteRows.length || effectiveApiPath ? remoteRows : rows;
  const filtered = effectiveRows.filter((row) =>
    Object.values(row).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase())
    )
  );
  const pagedRows = filtered.slice(0, pageSize);
  const showingFrom = filtered.length > 0 ? 1 : 0;
  const showingTo = Math.min(pageSize, filtered.length);

  return (
    <MainLayout>
      <div className="min-h-screen bg-transparent text-sm text-slate-800">

        {/* Breadcrumb */}
        <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-400">›</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="text-indigo-600 hover:underline">{crumb.label}</Link>
              ) : (
                <span className="font-semibold text-slate-700">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        {/* Title */}
        <h1 className="mb-0.5 text-[22px] font-black tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && (
          <p className="mb-4 text-xs text-slate-500">
            {description.replace('Need Help?', '')}
            {description.includes('Need Help?') && (
              <a href="#" className="text-indigo-600 hover:underline">Need Help?</a>
            )}
          </p>
        )}

        {/* Filter Card */}
        {resolvedFiltersWithStores.length > 0 && (
          <div className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_1px_12px_rgba(15,23,42,0.04)] sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {resolvedFiltersWithStores.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600">{f.label}</label>

                  {(f.type === 'date-range' || f.type === 'daterange') && (
                    <DateRangeFilter
                      value={filterValues[f.key]}
                      onChange={(value) => set(f.key, value)}
                    />
                  )}

                  {f.type === 'select' && (
                    <div className="relative">
                      <select
                        value={filterValues[f.key]}
                        onChange={(e) => set(f.key, e.target.value)}
                        className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
                      >
                        <option value="">Select</option>
                        {(f.options || []).map((o) => (
                          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </span>
                    </div>
                  )}

                  {f.type === 'text' && (
                      <input
                      type="text"
                      placeholder={f.placeholder || `Search for ${f.label.toLowerCase()}`}
                      value={filterValues[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Filter Actions */}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={handleDownload}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50"
                title="Download"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
                  <path d="M10 3v10m0 0l-3-3m3 3l3-3M4 17h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={handleApply}
                disabled={loading}
                className="flex-1 rounded-xl bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 sm:flex-none"
              >
                {loading ? 'Loading...' : 'Apply'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Extra actions (e.g. Convert B2B to B2C) */}
        {extraActions && <div className="mb-3">{extraActions}</div>}

        {/* Search */}
        <div className="mb-2 flex justify-end">
          <div className="relative w-full sm:w-auto">
            <svg className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 20 20">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M15 15l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:w-56"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_12px_rgba(15,23,42,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={handleAllCheck}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600"
                    />
                  </th>
                  {columns.map((col) => (
                    <th key={col.key} className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600">
                      {col.label}
                      <span className="ml-1 text-xs text-slate-300">▼ ⋮</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="py-20 text-center text-slate-400">
                      Loading report...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="py-20 text-center text-slate-400">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-50 transition-colors hover:bg-indigo-50/50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={checkedRows.includes(row.id)}
                          onChange={() => setCheckedRows((prev) =>
                            prev.includes(row.id) ? prev.filter((r) => r !== row.id) : [...prev, row.id]
                          )}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600"
                        />
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {row[col.key] ?? '-'}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="appearance-none rounded-xl border border-slate-200 bg-white px-3 py-1.5 pr-7 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
            >
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">▼</span>
          </div>
          <span className="text-xs text-slate-500">
            Showing {showingFrom} to {showingTo} of {filtered.length} {totalLabel}
          </span>
        </div>

      </div>
    </MainLayout>
  );
}
