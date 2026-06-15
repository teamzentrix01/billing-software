'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import SalesOrderListPage from '@/components/SalesOrderListPage';

const DEFAULT_BULK_OPERATIONS = ['Create Invoice', 'Write Off', 'Export'];

function formatTodayRange() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${today} - ${today}`;
}

function toCsv(columns, rows) {
  const csvHeader = columns.map((column) => column.label).join(',');
  const csvBody = rows.map((row) =>
    columns.map((column) => {
      const value = row[column.key];
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    }).join(',')
  );

  return `${csvHeader}\n${csvBody.join('\n')}`;
}

export default function SalesOrderSectionPage({
  view,
  breadcrumbs,
  title,
  description,
  columns,
  totalLabel = 'Results',
  emptyMessage = 'No matching record found',
  bulkOperations = DEFAULT_BULK_OPERATIONS,
  showBulkOps = true,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storeOptions, setStoreOptions] = useState([{ value: 'all', label: 'All Regions & Stores' }]);
  const lastQueryRef = useRef({ dateRange: formatTodayRange(), stores: 'all' });

  const endpoint = useMemo(() => `/api/sales-order/${view}`, [view]);

  const fetchStoreOptions = async () => {
    try {
      const res = await fetch('/api/stores');
      const data = await res.json();
      const stores = Array.isArray(data)
        ? data
        : Array.isArray(data?.stores)
          ? data.stores
          : Array.isArray(data?.data?.stores)
            ? data.data.stores
            : [];
      const options = stores
            .filter((store) => store && store.id !== undefined && store.name)
            .map((store) => ({ value: String(store.id), label: store.name }));

      setStoreOptions([
        { value: 'all', label: 'All Regions & Stores' },
        ...options,
      ]);
    } catch (err) {
      console.error(err);
      setStoreOptions([{ value: 'all', label: 'All Regions & Stores' }]);
    }
  };

  const fetchRows = async ({ dateRange = formatTodayRange(), stores = 'all' } = {}) => {
    lastQueryRef.current = { dateRange, stores };
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (dateRange) params.set('dateRange', dateRange);
      if (stores) params.set('stores', stores);

      const res = await fetch(`${endpoint}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to fetch ${title.toLowerCase()}`);

      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setRows([]);
      setError(err.message || `Failed to fetch ${title.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStoreOptions();
    fetchRows();
  }, [endpoint]);

  const handleFetch = ({ dateRange, stores }) => {
    fetchRows({ dateRange, stores });
  };

  const downloadCsv = (selectedRows) => {
    const csv = toCsv(columns, selectedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${view}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleBulkOperation = async ({ operation, selectedRows }) => {
    if (operation === 'Export') {
      downloadCsv(selectedRows);
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: operation,
          ids: selectedRows.map((row) => row.id),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process bulk action');

      await fetchRows(lastQueryRef.current);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to process bulk action');
    }
  };

  return (
    <SalesOrderListPage
      breadcrumbs={breadcrumbs}
      title={title}
      description={description}
      columns={columns}
      rows={rows}
      onFetch={handleFetch}
      onBulkOperation={handleBulkOperation}
      onDownload={downloadCsv}
      totalLabel={totalLabel}
      emptyMessage={error || emptyMessage}
      bulkOperations={bulkOperations}
      showBulkOps={showBulkOps}
      loading={loading}
      storeOptions={storeOptions}
      showViewAction={view === 'invoice-sales-order'}
    />
  );
}
