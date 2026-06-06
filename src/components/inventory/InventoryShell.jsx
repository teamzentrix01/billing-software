'use client';

import MainLayout from '@/components/MainLayout';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export default function InventoryShell({
  title,
  subtitle,
  breadcrumb,
  actions = [],
  searchPlaceholder,
  filters = [],
  stats = [],
  insights = [],
  cards = [],
  tableHeaders = [],
  tableData = [],
  searchValue,
  onSearchChange,
  onDownload,
  emptyMessage = 'No Records Found',
  showTable = true,
  rowActions = null,
}) {
  const [localSearch, setLocalSearch] = useState('');
  const activeSearch = typeof onSearchChange === 'function' ? (searchValue || '') : localSearch;
  const visibleTableData = useMemo(() => {
    const q = String(activeSearch || '').trim().toLowerCase();
    if (!q) return tableData;
    return tableData.filter((row) =>
      Object.values(row || {}).some((value) => String(value ?? '').toLowerCase().includes(q))
    );
  }, [activeSearch, tableData]);

  const renderActionElement = (item, className, content) => {
    if (item.href) {
      return (
        <Link href={item.href} className={className}>
          {content}
        </Link>
      );
    }

    return (
      <button type="button" onClick={item.onClick} className={className}>
        {content}
      </button>
    );
  };

  return (
    <MainLayout>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
        {breadcrumb.map((item, index) => (
          <span key={item.label} className="flex items-center gap-2">
            <span className={index === breadcrumb.length - 1 ? 'font-semibold text-slate-900' : 'text-indigo-600'}>
              {item.label}
            </span>
            {index < breadcrumb.length - 1 && <i className="ti ti-chevron-right text-[11px] text-slate-400" />}
          </span>
        ))}
      </div>

      <div className="mb-5 flex flex-col items-start justify-between gap-4 rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-[0_1px_12px_rgba(15,23,42,0.04)] sm:p-5 md:flex-row">
        <div className="min-w-0">
          <h1 className="text-[24px] font-black leading-tight tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
          <p className="mt-1 text-[12.5px] text-slate-400">{subtitle}</p>
        </div>

        {actions.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-shrink-0">
            {actions.map((action, index) => {
              const className = `flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors sm:flex-none ${
                  index === actions.length - 1 && action.primary
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'border border-indigo-200 text-indigo-600 hover:bg-indigo-50'
                }`;
              if (action.href) {
                return (
                  <Link key={action.label} href={action.href} className={className}>
                    {action.label}
                  </Link>
                );
              }
              return (
                <button
                  key={action.label}
                  type={action.type || 'button'}
                  onClick={action.onClick}
                  className={className}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {stats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          {stats.map((stat) => (
            <div key={stat.label} className="min-h-[98px] flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[12px] font-medium tracking-wide text-slate-400 uppercase">{stat.label}</p>
              {stat.value ? (
                <div className="text-[28px] font-black text-indigo-600 leading-none">{stat.value}</div>
              ) : (
                <div className="h-1 w-8 rounded-full bg-indigo-600/80" />
              )}
              <p className="text-[12.5px] text-slate-400">{stat.note}</p>
            </div>
          ))}
        </div>
      )}

      {insights.length > 0 && (
        <>
          <div className="mb-2 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-[12px] font-semibold text-amber-600">
            AI INSIGHTS
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            {insights.map((insight) => (
              <div key={insight.title} className="min-h-[130px] rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <h3 className="text-[13px] font-semibold text-amber-900">{insight.title}</h3>
                <p className="mt-2 text-[12px] leading-5 text-amber-900/85">{insight.text}</p>
                {renderActionElement(
                  insight,
                  'mt-4 inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-[12px] font-semibold text-white',
                  insight.button
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {cards.map((card) => (
            <div key={card.title} className="min-h-[78px] rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {renderActionElement(
                card,
                'flex h-full w-full items-center justify-between rounded-2xl p-4 text-left transition-colors hover:bg-indigo-50/50',
                <>
                  <span>
                    <span className="block text-[13px] font-semibold text-slate-900">{card.title}</span>
                    <span className="mt-1 block text-[12px] text-slate-400">{card.text}</span>
                  </span>
                  <i className="ti ti-chevron-right text-slate-400 text-[16px]" />
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {showTable && tableHeaders.length > 0 && (
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 max-w-full flex-[1_1_260px] items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 sm:max-w-[340px]">
            <i className="ti ti-search text-slate-400 text-[16px]" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={activeSearch}
              onChange={(e) => {
                if (typeof onSearchChange === 'function') onSearchChange(e.target.value);
                else setLocalSearch(e.target.value);
              }}
              className="flex-1 bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {Array.isArray(filters) ? filters.map((filter) => (
              <button key={filter} type="button" className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600 transition-colors hover:bg-slate-50">
                <i className="ti ti-filter text-[14px] text-indigo-500" />
                {filter}
                <i className="ti ti-chevron-down text-[11px]" />
              </button>
            )) : filters}
            <button type="button" onClick={onDownload} className="rounded-xl border border-slate-200 p-2 transition-colors hover:bg-slate-50">
              <i className="ti ti-download text-slate-500 text-[16px]" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b border-slate-100">
                {tableHeaders.map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {header}
                  </th>
                ))}
                {rowActions && (
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleTableData.length > 0 ? (
                  visibleTableData.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-slate-100 transition-colors hover:bg-indigo-50/50">
                    {tableHeaders.map((header, colIdx) => (
                      <td key={colIdx} className="px-4 py-3 text-[13px] text-slate-700">
                        {row[header] || '-'}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-4 py-3 text-right">
                        {rowActions(row)}
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={tableHeaders.length + (rowActions ? 1 : 0)} className="px-4 py-14 text-center text-[14px] font-medium text-indigo-700">
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 text-[12px] text-slate-400">
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-600">
            <option>10</option>
          </select>
          <span>Showing {visibleTableData.length ? `1 to ${visibleTableData.length}` : '0 to 0'} of {visibleTableData.length} Results</span>
        </div>
      </div>
      )}
    </MainLayout>
  );
}
