"use client";

import { useEffect, useMemo, useState } from 'react';
import InventoryShell from '@/components/inventory/InventoryShell';
import { getBulkField, parseBulkSheet, pickSpreadsheetFile, toBoolean } from '@/lib/bulkSheet';
import { formatIndianDate, toDateInputValue } from '@/lib/dateUtils';
import {
  addOptionNamedRanges,
  applyTextFormatToColumns,
  buildOptionsSheet,
  hideOptionsSheet,
  optionFormula,
  saveWorkbookWithValidations,
  sortOptions,
  uniqueOptions,
} from '@/lib/xlsxDropdowns';

async function fetchStores() {
  const res = await fetch('/api/stores');
  if (!res.ok) throw new Error('Failed to fetch stores');
  const json = await res.json();
  return json.data?.records || json.data?.stores || json.stores || [];
}

async function fetchTransfers() {
  const res = await fetch('/api/inventory/stocktransfer');
  if (!res.ok) throw new Error('Failed to fetch stock transfers');
  return res.json();
}

async function fetchInventoryProducts(storeId, searchTerm) {
  if (!storeId) return [];
  const params = new URLSearchParams({
    store_id: String(storeId),
    search: searchTerm,
    pageSize: '50',
  });
  const res = await fetch(`/api/inventory/products?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch inventory products');
  const json = await res.json();
  return json.data?.records || json.records || [];
}

async function postTransfer(payload) {
  const res = await fetch('/api/inventory/stocktransfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create stock transfer');
  return data;
}

async function confirmTransfer(id, payload) {
  const res = await fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to confirm stock transfer');
  return data;
}

async function revertTransfer(id) {
  const res = await fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}/revert`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to revert stock transfer');
  return data;
}

async function fetchTransferDetails(id) {
  const res = await fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load stock transfer');
  return data;
}

async function updateTransferDetails(id, payload) {
  const res = await fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update stock transfer');
  return data;
}

const tableHeaders = [
  'Transaction ID',
  'Invoice Number',
  'Source Name',
  'Destination Name',
  'Invoice Date',
  'Total Item Number',
  'Cost',
];

function formatDate(value) {
  return formatIndianDate(value, '-');
}

function formatCost(value) {
  const n = Number(value || 0);
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mapTransfersToTable(records) {
  return (records || []).map((row) => ({
    _id: row.id,
    'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#TRN-${row.id}`,
    'Invoice Number': row.invoiceNumber || '-',
    'Source Name': row.sourceName || '-',
    'Destination Name': row.destinationName || '-',
    'Invoice Date': formatDate(row.invoiceDate),
    'Total Item Number': row.totalItems ?? 0,
    Cost: formatCost(row.cost),
    _invoiceDate: row.invoiceDate || '',
    _source: row.sourceName || '',
    _revertedAt: row.revertedAt || '',
  }));
}

function getLocationType(location) {
  return String(location?.meta?.locationType || 'Store').trim() || 'Store';
}

function getLocationOption(location) {
  return `${location.id} - ${location.name} (${getLocationType(location)})`;
}

function normalizeCompare(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveLocationId(value, locations) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const leadingId = raw.match(/^\d+/)?.[0];
  if (leadingId && locations.some((location) => String(location.id) === leadingId)) {
    return leadingId;
  }
  const exact = locations.find(
    (location) =>
      normalizeCompare(location.name) === normalizeCompare(raw) ||
      normalizeCompare(getLocationOption(location)) === normalizeCompare(raw),
  );
  return exact ? String(exact.id) : raw;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getNumericId(value) {
  const raw = String(value ?? '').trim();
  const leading = raw.match(/^\d+/)?.[0];
  return leading || raw;
}

function getBatchId(product) {
  const direct = product?.batchId ?? product?.batch_id;
  if (direct) return String(direct).match(/\d+/g)?.pop() || direct;
  const composite = String(product?.id ?? product?.product_id ?? '').trim();
  const parts = composite.match(/\d+/g) || [];
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

function getRowDate(value) {
  if (!value) return '';
  return toDateInputValue(value) || String(value).trim();
}

function buildTransferGroupKey(row) {
  return [
    row.sourceId,
    row.destinationId,
    row.invoiceDate,
    row.invoiceNumber,
    row.otherCharges,
    row.remarks,
    row.applyTaxes ? 'tax' : 'no-tax',
  ].join('|');
}

function findExactProduct(records, { barcode, sku, productName }) {
  const cleanBarcode = normalizeCompare(barcode);
  const cleanSku = normalizeCompare(sku);
  const cleanName = normalizeCompare(productName);
  return (
    records.find((product) => cleanBarcode && normalizeCompare(product.barcode) === cleanBarcode) ||
    records.find((product) => cleanSku && normalizeCompare(product.sku) === cleanSku) ||
    records.find((product) => cleanName && normalizeCompare(product.name) === cleanName) ||
    null
  );
}

export default function StockTransferPage() {
  const [showModal, setShowModal] = useState(false);
  const [stores, setStores] = useState([]);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [applyTaxes, setApplyTaxes] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingStores, setLoadingStores] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [tableData, setTableData] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [listFilters, setListFilters] = useState({ dateFrom: '', dateTo: '', source: '' });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingRevert, setPendingRevert] = useState(null);
  const [revertingId, setRevertingId] = useState(null);
  const [previewTransfer, setPreviewTransfer] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editTransfer, setEditTransfer] = useState(null);
  const [editForm, setEditForm] = useState({
    invoice_date: '',
    invoice_number: '',
    other_charges: '',
    remarks: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const visibleTableData = useMemo(() => {
    return tableData.filter((row) => {
      const invoiceTime = row._invoiceDate ? new Date(row._invoiceDate).getTime() : null;
      if (listFilters.dateFrom && invoiceTime && invoiceTime < new Date(listFilters.dateFrom).getTime()) return false;
      if (listFilters.dateTo && invoiceTime && invoiceTime > new Date(`${listFilters.dateTo}T23:59:59`).getTime()) return false;
      if (listFilters.source && String(row._source || '') !== listFilters.source) return false;
      return true;
    });
  }, [tableData, listFilters]);

  const sourceOptions = useMemo(
    () => Array.from(new Set(tableData.map((row) => row._source).filter(Boolean))).sort(),
    [tableData]
  );

  const loadList = () => {
    setLoadingList(true);
    fetchTransfers()
      .then((records) => setTableData(mapTransfersToTable(records)))
      .catch(() => setTableData([]))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!showModal) return;
    setLoadingStores(true);
    fetchStores()
      .then((data) => setStores(Array.isArray(data) ? data : []))
      .catch(() => setStores([]))
      .finally(() => setLoadingStores(false));
  }, [showModal]);

  const openModal = () => {
    setSource('');
    setDestination('');
    setApplyTaxes(true);
    setShowModal(true);
  };

  const loadLocations = async () => {
    const data = await fetchStores();
    const locations = Array.isArray(data) ? data : [];
    setStores(locations);
    return locations;
  };

  const handleDownloadBulkTemplate = async () => {
    setBulkBusy(true);
    try {
      const XLSX = await import('xlsx');
      const locations = stores.length ? stores : await loadLocations();
      const locationOptions = sortOptions(uniqueOptions(locations.map(getLocationOption)));
      const yesNoOptions = ['Yes', 'No'];
      const headers = [
        'Source',
        'Destination',
        'Barcode',
        'SKU',
        'Product Name',
        'Quantity',
        'MRP On Destination',
        'Selling Price On Destination',
        'Cost/Unit',
        'Invoice Date',
        'Invoice Number',
        'Other Charges',
        'Remarks',
        'Apply Taxes',
      ];
      const rows = [headers];

      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 34 },
        { wch: 34 },
        { wch: 18 },
        { wch: 18 },
        { wch: 30 },
        { wch: 12 },
        { wch: 20 },
        { wch: 26 },
        { wch: 14 },
        { wch: 14 },
        { wch: 18 },
        { wch: 16 },
        { wch: 26 },
        { wch: 14 },
      ];
      applyTextFormatToColumns(worksheet, headers, ['Barcode', 'SKU', 'Invoice Number']);

      const optionGroups = [
        { key: 'locations', name: 'TransferLocations', values: locationOptions },
        { key: 'yes_no', name: 'YesNoOptions', values: yesNoOptions },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Bulk Stock Transfer');
      XLSX.utils.book_append_sheet(workbook, buildOptionsSheet(optionGroups), 'Options');
      addOptionNamedRanges(workbook, optionGroups);
      hideOptionsSheet(workbook);

      await saveWorkbookWithValidations(
        workbook,
        'stock-transfer-bulk-template.xlsx',
        [
          {
            range: 'A2:A501',
            formula: optionFormula(optionGroups, 'locations'),
            errorTitle: 'Invalid source',
            error: 'Select a source from the dropdown.',
            promptTitle: 'Source',
            prompt: 'Select source store or warehouse.',
          },
          {
            range: 'B2:B501',
            formula: optionFormula(optionGroups, 'locations'),
            errorTitle: 'Invalid destination',
            error: 'Select a destination from the dropdown.',
            promptTitle: 'Destination',
            prompt: 'Select destination store or warehouse.',
          },
          {
            range: 'N2:N501',
            formula: optionFormula(optionGroups, 'yes_no'),
            errorTitle: 'Invalid tax option',
            error: 'Select Yes or No.',
            promptTitle: 'Apply Taxes',
            prompt: 'Choose whether tax should be applied.',
          },
        ],
        'xl/worksheets/sheet1.xml',
        { quotePrefixRanges: ['C2:C501', 'D2:D501', 'K2:K501'] },
      );
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to download stock transfer template');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkImport = async () => {
    setBulkBusy(true);
    try {
      const locations = stores.length ? stores : await loadLocations();
      const file = await pickSpreadsheetFile();
      if (!file) return;

      const rows = await parseBulkSheet(file);
      if (!rows.length) {
        alert('No rows found in selected file.');
        return;
      }

      const preparedRows = [];
      const errors = [];

      for (const row of rows) {
        const rowNumber = Number(row.__row_index || 0) + 2;
        const sourceId = resolveLocationId(getBulkField(row, ['source_id', 'source']), locations);
        const destinationId = resolveLocationId(getBulkField(row, ['destination_id', 'destination']), locations);
        const barcode = getBulkField(row, ['barcode', 'bar_code']);
        const sku = getBulkField(row, ['sku']);
        const productName = getBulkField(row, ['product_name', 'product']);
        const qty = toNumber(getBulkField(row, ['quantity', 'qty']), 0);
        const invoiceDate = getRowDate(getBulkField(row, ['invoice_date', 'date']));
        const invoiceNumber = getBulkField(row, ['invoice_number', 'invoice_no']);
        const otherCharges = toNumber(getBulkField(row, ['other_charges']), 0);
        const remarks = getBulkField(row, ['remarks', 'remark']);
        const applyTaxes = toBoolean(getBulkField(row, ['apply_taxes']), true);

        const sourceExists = locations.some((location) => String(location.id) === String(sourceId));
        const destinationExists = locations.some((location) => String(location.id) === String(destinationId));

        if (!sourceId || !destinationId) {
          errors.push(`Row ${rowNumber}: source and destination are required.`);
          continue;
        }
        if (!sourceExists || !destinationExists) {
          errors.push(`Row ${rowNumber}: source or destination does not match an existing store/warehouse.`);
          continue;
        }
        if (String(sourceId) === String(destinationId)) {
          errors.push(`Row ${rowNumber}: source and destination cannot be the same.`);
          continue;
        }
        if (!barcode && !sku && !productName) {
          errors.push(`Row ${rowNumber}: barcode, SKU or product name is required.`);
          continue;
        }
        if (qty <= 0) {
          errors.push(`Row ${rowNumber}: quantity must be greater than zero.`);
          continue;
        }

        try {
          const searchValue = barcode || sku || productName;
          const records = await fetchInventoryProducts(sourceId, searchValue);
          const product = findExactProduct(records, { barcode, sku, productName });
          if (!product) {
            errors.push(`Row ${rowNumber}: product not found in source inventory.`);
            continue;
          }
          const availableStock = toNumber(product.availableStock ?? product.available_stock, 0);
          if (qty > availableStock) {
            errors.push(`Row ${rowNumber}: ${product.name} has only ${availableStock} available.`);
            continue;
          }

          const costPrice = toNumber(getBulkField(row, ['cost_unit', 'cost_per_unit', 'cost_price', 'cost']), toNumber(product.cost_price, 0));
          const mrp = toNumber(getBulkField(row, ['mrp', 'mrp_on_destination', 'mrp_on_destination_store', 'destination_mrp']), toNumber(product.mrp, 0));
          const sellingPrice = toNumber(
            getBulkField(row, ['selling_price', 'selling_price_on_destination', 'destination_selling_price']),
            toNumber(product.selling_price || product.sellingPrice, mrp),
          );
          const taxRate = toNumber(product.taxRate ?? product.tax_rate, 0);

          preparedRows.push({
            sourceId: String(sourceId),
            destinationId: String(destinationId),
            invoiceDate,
            invoiceNumber,
            otherCharges,
            remarks,
            applyTaxes,
            item: {
              product_id: getNumericId(product.id ?? product.product_id),
              batch_id: getBatchId(product),
              name: product.name || productName,
              sku: product.sku || sku,
              barcode: product.barcode || barcode,
              qty,
              cost_price: costPrice,
              mrp,
              destination_mrp: mrp,
              selling_price: sellingPrice,
              tax_value: applyTaxes ? (costPrice * taxRate) / 100 : 0,
              available_stock: availableStock,
              meta: { bulkTransfer: true, sourceRow: rowNumber },
            },
          });
        } catch (err) {
          errors.push(`Row ${rowNumber}: ${err.message || 'product lookup failed'}`);
        }
      }

      if (!preparedRows.length) {
        alert(`Could not import any row.${errors.length ? `\n\n${errors.slice(0, 8).join('\n')}` : ''}`);
        return;
      }

      const groups = new Map();
      for (const row of preparedRows) {
        const key = buildTransferGroupKey(row);
        if (!groups.has(key)) groups.set(key, { ...row, items: [] });
        groups.get(key).items.push(row.item);
      }

      const confirmed = [];
      for (const group of groups.values()) {
        const draft = await postTransfer({
          source: group.sourceId,
          destination: group.destinationId,
          applyTaxes: group.applyTaxes,
          bulkImport: true,
        });
        await confirmTransfer(draft.id, {
          form: {
            invoice_date: group.invoiceDate,
            invoice_number: group.invoiceNumber,
            other_charges: group.otherCharges,
            remarks: group.remarks,
            bulk_import: true,
          },
          items: group.items,
        });
        confirmed.push(draft);
      }

      alert(
        `Bulk transfer complete: ${confirmed.length} transfer(s), ${preparedRows.length} item row(s).${
          errors.length ? `\n\nSkipped rows:\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n...and ${errors.length - 8} more` : ''}` : ''
        }`,
      );
      loadList();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Bulk import failed. Please use a valid Excel/CSV file.');
    } finally {
      setBulkBusy(false);
    }
  };

  const next = async () => {
    if (!source) return alert('Please select a source');
    if (!destination) return alert('Please select a destination');
    if (String(source) === String(destination)) return alert('Source and destination cannot be the same');

    setSubmitting(true);
    try {
      const created = await postTransfer({ source, destination, applyTaxes });
      setShowModal(false);
      setDraftId(created.id);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create stock transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevert = async (row) => {
    if (!row?._id) return;
    setPendingRevert(row);
  };

  const openPreview = async (row) => {
    if (!row?._id) return;
    setPreviewLoading(true);
    setPreviewTransfer({ id: row._id, transactionId: String(row['Transaction ID'] || '').replace(/^#/, '') });
    try {
      const details = await fetchTransferDetails(row._id);
      setPreviewTransfer(details);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to load stock transfer preview');
      setPreviewTransfer(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const openEdit = async (row) => {
    if (!row?._id) return;
    try {
      const details = await fetchTransferDetails(row._id);
      setEditTransfer(details);
      setEditForm({
        invoice_date: details.invoice_date || '',
        invoice_number: details.invoice_number || '',
        other_charges: details.other_charges ?? '',
        remarks: details.remarks || '',
      });
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to load stock transfer');
    }
  };

  const saveEdit = async () => {
    if (!editTransfer?.id) return;
    setSavingEdit(true);
    try {
      await updateTransferDetails(editTransfer.id, editForm);
      setEditTransfer(null);
      alert('Stock transfer updated successfully.');
      loadList();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to update stock transfer');
    } finally {
      setSavingEdit(false);
    }
  };

  const downloadEntryExcel = async (row) => {
    if (!row?._id) return;
    try {
      const transfer = await fetchTransferDetails(row._id);
      await downloadTransferWorkbook(transfer);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to download stock transfer Excel');
    }
  };

  const confirmRevert = async () => {
    const row = pendingRevert;
    const id = row?._id;
    if (!id) return;
    setRevertingId(id);
    setLoadingList(true);
    try {
      await revertTransfer(id);
      setPendingRevert(null);
      alert('Stock transfer reverted successfully.');
      loadList();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to revert stock transfer');
      setLoadingList(false);
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <>
      <InventoryShell
        breadcrumb={[{ label: 'Inventory' }, { label: 'Stock Transfer' }]}
        title="Stock Transfer"
        subtitle="Stock Transfer transaction history of last 7 days. Need Help?"
        actions={[
          { label: bulkBusy ? 'Working...' : 'Upload Bulk Sheet', onClick: handleBulkImport },
          { label: 'Download Template', onClick: handleDownloadBulkTemplate },
          { label: 'Stock Transfer', primary: true, onClick: openModal },
        ]}
        searchPlaceholder="Search"
        filters={(
          <>
            <input
              type="date"
              value={listFilters.dateFrom}
              onChange={(e) => setListFilters((current) => ({ ...current, dateFrom: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
              title="From date"
            />
            <input
              type="date"
              value={listFilters.dateTo}
              onChange={(e) => setListFilters((current) => ({ ...current, dateTo: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
              title="To date"
            />
            <select
              value={listFilters.source}
              onChange={(e) => setListFilters((current) => ({ ...current, source: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
            >
              <option value="">All sources</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setListFilters({ dateFrom: '', dateTo: '', source: '' })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600 hover:bg-slate-50"
            >
              Reset
            </button>
          </>
        )}
        tableHeaders={tableHeaders}
        tableData={loadingList ? [] : visibleTableData}
        emptyMessage={loadingList ? 'Loading records...' : 'No Records Found'}
        rowActions={(row) => (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => openPreview(row)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => openEdit(row)}
              className="rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleRevert(row)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-50"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={() => downloadEntryExcel(row)}
              className="rounded-lg border border-emerald-200 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Excel
            </button>
          </div>
        )}
      />

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-[668px] overflow-hidden rounded bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-[22px] py-5">
              <h3 className="text-[24px] font-semibold leading-none text-gray-900">Step 1: Fill Details</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <i className="ti ti-x text-[24px]" />
              </button>
            </div>

            <div className="px-[22px] py-[34px]">
              <button
                type="button"
                className="mb-9 h-[45px] w-[294px] rounded border border-blue-500 bg-cyan-100 text-[15px] font-semibold text-gray-800"
              >
                Stock Transfer
              </button>

              <div className="mb-6">
                <label className="mb-2 block text-[15px] text-gray-700">
                  Source <span className="font-semibold text-red-500">*</span>
                </label>
                <SelectBox
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Please Select a Source."
                  stores={stores}
                  loading={loadingStores}
                />
              </div>

              <div className="mb-6">
                <label className="mb-2 block text-[15px] text-gray-700">
                  Destination <span className="font-semibold text-red-500">*</span>
                </label>
                <SelectBox
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Please select a destination."
                  stores={stores}
                  loading={loadingStores}
                />
              </div>

              <label className="inline-flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={applyTaxes}
                  onChange={(e) => setApplyTaxes(e.target.checked)}
                  className="h-5 w-5 accent-amber-400"
                />
                <span className="text-[16px] font-semibold text-gray-900">Apply Taxes On This Transaction</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-5 border-t border-gray-200 px-4 py-4">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded border border-blue-600 px-4 py-2 text-[14px] font-medium text-blue-600 hover:bg-blue-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={next}
                disabled={submitting}
                className="rounded bg-blue-600 px-5 py-2 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '...' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {draftId && (
        <TransferLineItemsWindow
          id={draftId}
          onClose={() => setDraftId(null)}
          onConfirmed={() => {
            setDraftId(null);
            loadList();
          }}
        />
      )}

      {pendingRevert && (
        <RevertConfirmDialog
          row={pendingRevert}
          busy={revertingId === pendingRevert._id}
          onCancel={() => {
            if (!revertingId) setPendingRevert(null);
          }}
          onConfirm={confirmRevert}
        />
      )}

      {(previewTransfer || previewLoading) && (
        <StockTransferPreviewDialog
          transfer={previewTransfer}
          loading={previewLoading}
          onClose={() => {
            if (!previewLoading) setPreviewTransfer(null);
          }}
        />
      )}

      {editTransfer && (
        <StockTransferEditDialog
          transfer={editTransfer}
          form={editForm}
          onChange={setEditForm}
          saving={savingEdit}
          onCancel={() => {
            if (!savingEdit) setEditTransfer(null);
          }}
          onSave={saveEdit}
        />
      )}
    </>
  );
}

async function downloadTransferWorkbook(transfer) {
  const XLSX = await import('xlsx');
  const summaryHeaders = [
    'Transaction ID',
    'Invoice Number',
    'Invoice Date',
    'Source',
    'Destination',
    'Status',
    'Other Charges',
    'Remarks',
  ];
  const summaryValues = [
    transfer.transactionId || transfer.id || '',
    transfer.invoice_number || '',
    formatDate(transfer.invoice_date),
    transfer.sourceName || transfer.source || '',
    transfer.destinationName || transfer.destination || '',
    transfer.status || '',
    Number(transfer.other_charges || 0),
    transfer.remarks || '',
  ];
  const summaryRows = [summaryHeaders, summaryValues];
  const itemRows = (transfer.items || []).map((item, index) => {
    const meta = typeof item.meta === 'object' && item.meta ? item.meta : {};
    return {
      'S.No.': index + 1,
      Product: item.product_name || item.name || '',
      SKU: item.sku || '',
      Barcode: item.barcode || '',
      'Batch No': item.batch_no || meta.batchNo || meta.batch_no || '',
      Expiry: formatDate(item.expiry_date || meta.expiryDate || meta.expiry_date),
      Qty: Number(item.qty || 0),
      MRP: Number(item.mrp || 0),
      'Selling Price': Number(item.selling_price || 0),
      'Destination MRP': Number(item.destination_mrp || 0),
      'Cost Price': Number(item.cost_price || 0),
      Tax: Number(item.tax_value || 0),
      'Line Cost': Number(item.qty || 0) * Number(item.cost_price || 0),
    };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemRows), 'Products');
  XLSX.writeFile(workbook, `stock-transfer-${transfer.transactionId || transfer.id || 'entry'}.xlsx`);
}

function StockTransferPreviewDialog({ transfer, loading, onClose }) {
  const items = transfer?.items || [];
  const totalQty = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const totalCost = items.reduce(
    (sum, item) => sum + (Number(item.qty || 0) * Number(item.cost_price || 0)),
    Number(transfer?.other_charges || 0),
  );
  const totalTax = items.reduce(
    (sum, item) => sum + (Number(item.qty || 0) * Number(item.tax_value || 0)),
    0,
  );

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[16px] font-black text-slate-900">Stock Transfer Preview</h2>
            <p className="mt-1 text-[12px] font-medium text-slate-500">
              {transfer?.transactionId ? `#${transfer.transactionId}` : transfer?.id ? `#TRN-${transfer.id}` : 'Loading...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close preview"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="overflow-auto px-5 py-5">
          {loading ? (
            <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-[13px] font-semibold text-slate-500">
              Loading preview...
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <PreviewStat label="Source" value={transfer?.sourceName || '-'} />
                <PreviewStat label="Destination" value={transfer?.destinationName || '-'} />
                <PreviewStat label="Invoice Number" value={transfer?.invoice_number || '-'} />
                <PreviewStat label="Invoice Date" value={formatDate(transfer?.invoice_date)} />
                <PreviewStat label="Total Items" value={totalQty} />
                <PreviewStat label="Cost" value={`Rs. ${formatCurrency(totalCost)}`} />
                <PreviewStat label="Tax" value={`Rs. ${formatCurrency(totalTax)}`} />
                <PreviewStat label="Status" value={transfer?.status || '-'} />
              </div>

              {transfer?.remarks && (
                <div className="mt-4 rounded-xl border border-slate-200 p-3">
                  <p className="text-[11px] font-bold uppercase text-slate-500">Remarks</p>
                  <p className="mt-1 text-[13px] text-slate-700">{transfer.remarks}</p>
                </div>
              )}

              <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-100 text-[13px]">
                  <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">MRP</th>
                      <th className="px-3 py-2">Selling</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Tax</th>
                      <th className="px-3 py-2">Line Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length ? (
                      items.map((item) => (
                        <tr key={item.id || item.product_id}>
                          <td className="px-3 py-3 text-slate-900">
                            <div className="font-semibold">{item.product_name || item.name || 'Product'}</div>
                            <div className="text-[11px] text-slate-500">SKU: {item.sku || '-'}</div>
                          </td>
                          <td className="px-3 py-3 text-slate-700">{Number(item.qty || 0)}</td>
                          <td className="px-3 py-3 text-slate-700">{formatCurrency(item.mrp)}</td>
                          <td className="px-3 py-3 text-slate-700">{formatCurrency(item.selling_price)}</td>
                          <td className="px-3 py-3 text-slate-700">{formatCurrency(item.cost_price)}</td>
                          <td className="px-3 py-3 text-slate-700">{formatCurrency(item.tax_value)}</td>
                          <td className="px-3 py-3 font-semibold text-slate-900">
                            {formatCurrency(Number(item.qty || 0) * Number(item.cost_price || 0))}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                          No items found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StockTransferEditDialog({ transfer, form, onChange, saving, onCancel, onSave }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[16px] font-black text-slate-900">Edit Stock Transfer</h2>
            <p className="mt-1 text-[12px] font-medium text-slate-500">
              #{transfer.transactionId || `TRN-${transfer.id}`} · {transfer.sourceName || '-'} to {transfer.destinationName || '-'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close edit dialog"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice Date">
              <input
                type="date"
                value={form.invoice_date}
                onChange={(e) => onChange((current) => ({ ...current, invoice_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700 outline-none focus:border-blue-400"
              />
            </Field>
            <Field label="Invoice Number">
              <input
                value={form.invoice_number}
                onChange={(e) => onChange((current) => ({ ...current, invoice_number: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700 outline-none focus:border-blue-400"
                placeholder="Invoice number"
              />
            </Field>
          </div>

          <Field label="Other Charges">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.other_charges}
              onChange={(e) => onChange((current) => ({ ...current, other_charges: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700 outline-none focus:border-blue-400"
              placeholder="Other charges"
            />
          </Field>

          <Field label="Remarks">
            <textarea
              rows={4}
              value={form.remarks}
              onChange={(e) => onChange((current) => ({ ...current, remarks: e.target.value }))}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700 outline-none focus:border-blue-400"
              placeholder="Remarks"
            />
          </Field>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-w-[96px] rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="min-w-[112px] rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewStat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-1 break-words text-[13px] font-semibold capitalize text-slate-900">{value}</p>
    </div>
  );
}

function RevertConfirmDialog({ row, busy, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="revert-dialog-title"
        aria-describedby="revert-dialog-message"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <i className="ti ti-rotate-2 text-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="revert-dialog-title" className="text-[15px] font-black text-slate-900">
              Revert stock transfer?
            </h2>
            <p className="mt-1 text-[12px] font-medium text-slate-500">
              This action will reverse the selected transfer.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p id="revert-dialog-message" className="text-[14px] font-semibold leading-6 text-slate-800">
            Revert {row['Transaction ID']}?
          </p>
          <p className="mt-2 text-[13px] leading-6 text-slate-600">
            Stock will be removed from <strong>{row['Destination Name']}</strong> and added back to <strong>{row['Source Name']}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-w-[96px] rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="min-w-[112px] rounded-xl bg-[#B00000] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_10px_20px_rgba(176,0,0,0.22)] transition-colors hover:bg-[#930000] disabled:opacity-60"
          >
            {busy ? 'Reverting...' : 'Revert'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectBox({ value, onChange, placeholder, stores, loading }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        className="h-10 w-full appearance-none rounded border border-gray-300 bg-white px-3 pr-12 text-[16px] text-gray-700 outline-none focus:border-blue-400"
      >
        <option value="">{placeholder}</option>
        {loading ? (
          <option disabled>Loading...</option>
        ) : (
          stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))
        )}
      </select>
      <span className="absolute right-10 top-2 h-6 border-l border-gray-300" />
      <i className="ti ti-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-gray-400" />
    </div>
  );
}

function TransferLineItemsWindow({ id, onClose, onConfirmed }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartFilter, setCartFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    invoice_date: '',
    invoice_number: '',
    other_charges: '',
    remarks: '',
  });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data) => {
        setDraft(data);
        if (data && !data.error) {
          setForm({
            invoice_date: data.invoice_date || '',
            invoice_number: data.invoice_number || '',
            other_charges: data.other_charges ?? '',
            remarks: data.remarks || '',
          });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const storeId = draft?.source || draft?.source_id || draft?.sourceId;
      if (!storeId) {
        setProducts([]);
        return;
      }
      fetchInventoryProducts(storeId, searchTerm)
        .then((records) => setProducts((records || []).filter((product) => Number(product.availableStock ?? product.available_stock ?? 0) > 0)))
        .catch(() => setProducts([]));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, draft?.source, draft?.source_id, draft?.sourceId]);

  const filteredCart = cartFilter.trim()
    ? cart.filter((item) => (item.name || '').toLowerCase().includes(cartFilter.toLowerCase()))
    : cart;

  const totals = cart.reduce(
    (acc, item) => {
      const qty = Number(item.qty || 0);
      const cost = Number(item.cost_price || 0);
      acc.totalItems += qty;
      acc.totalCost += qty * cost;
      acc.totalTax += Number(item.tax_value || 0) * qty;
      return acc;
    },
    { totalItems: 0, totalCost: Number(form.other_charges || 0), totalTax: 0 }
  );

  const addToCart = (product) => {
    const productId = getNumericId(product.id ?? product.product_id);
    const availableStock = Number(product.availableStock ?? product.available_stock ?? 0);
    if (availableStock <= 0) return;
    setCart((current) => {
      const existing = current.find((item) => String(item.product_id) === String(productId));
      if (existing) {
        const nextQty = Math.min(Number(existing.qty) + 1, availableStock);
        return current.map((item) =>
          String(item.product_id) === String(productId)
            ? { ...item, qty: nextQty }
            : item
        );
      }
      const cost = Number(product.cost_price || 0);
      const mrp = Number(product.mrp || 0);
      const sellingPrice = Number(
        product.selling_price || product.sellingPrice || product.mrp || 0
      );
      const taxRate = Number(product.tax_rate || 0);
      return [
        ...current,
        {
          product_id: productId,
          batch_id: getBatchId(product),
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          cost_price: cost,
          mrp,
          destination_mrp: mrp,
          selling_price: sellingPrice,
          tax_value: draft?.applyTaxes ? (cost * taxRate) / 100 : 0,
          available_stock: availableStock,
          qty: 1,
        },
      ];
    });
    setSearchTerm('');
    setProducts([]);
  };

  const updateQty = (productId, qty) => {
    const nextQty = toNumber(qty, 0);
    setCart((current) =>
      current.map((item) =>
        String(item.product_id) === String(productId)
          ? {
              ...item,
              qty: Math.min(
                Math.max(0.001, nextQty || 0.001),
                Number(item.available_stock || 0.001),
              ),
            }
          : item
      )
    );
  };

  const validateCart = () => {
    for (const item of cart) {
      const qty = Number(item.qty || 0);
      const available = Number(item.available_stock || 0);
      if (qty > available) {
        alert(`${item.name} only has ${available} available in the source store.`);
        return false;
      }
    }
    return true;
  };

  const confirm = async () => {
    if (cart.length === 0) return alert('Add at least one product');
    if (!validateCart()) return;

    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm stock transfer');
      onConfirmed();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm stock transfer');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed bottom-0 right-0 top-[104px] z-[35] bg-[#f1f2f5] md:left-[418px] max-md:left-0">
      <div className="relative h-full overflow-hidden border-t border-gray-200 bg-[#f1f2f5] shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="flex h-12 items-center justify-between border-b border-gray-200 bg-[#f1f2f5] px-9">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-gray-500">Inventory</span>
            <i className="ti ti-chevron-right text-[11px] text-gray-400" />
            <span className="font-semibold text-gray-900">Stock Transfer</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="Close line items"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="absolute bottom-[88px] left-0 right-0 top-12 grid grid-cols-[350px_minmax(520px,1fr)] gap-6 overflow-auto px-9 py-6 max-lg:grid-cols-1 max-lg:px-4">
          <aside className="h-full min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h3 className="mb-5 text-[15px] font-semibold text-blue-600">Stock Information</h3>

            <div className="mb-4">
              <label className="mb-1 block text-[12px] text-gray-500">Source</label>
              <p className="text-[13px] font-medium text-gray-900">{loading ? '...' : draft?.sourceName || '-'}</p>
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-[12px] text-gray-500">Destination</label>
              <p className="text-[13px] font-medium text-gray-900">{loading ? '...' : draft?.destinationName || '-'}</p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <Field label="Invoice Date">
                <input
                  type="date"
                  value={form.invoice_date}
                  onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400"
                />
              </Field>
              <Field label="Invoice Number">
                <input
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="10"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
                />
              </Field>
            </div>

            <Field label="Other Charges">
              <input
                value={form.other_charges}
                onChange={(e) => setForm({ ...form, other_charges: e.target.value })}
                placeholder="Other Charges"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
              />
            </Field>
            <Field label="Remarks">
              <textarea
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Remarks"
                rows={5}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
              />
            </Field>
          </aside>

          <main className="flex h-full min-w-0 flex-col">
            <div className="mb-4 flex flex-shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <i className="ti ti-search text-[16px] text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
              />
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
                <div>
                  <h2 className="text-[14px] font-semibold text-gray-900">Inventory - Stock Transfer</h2>
                  <p className="mt-0.5 text-[12px] text-gray-500">Select desired products & proceed</p>
                </div>
                <div className="flex min-w-[200px] items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 max-sm:hidden">
                  <input
                    type="text"
                    placeholder="Search"
                    value={cartFilter}
                    onChange={(e) => setCartFilter(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
                  />
                  <i className="ti ti-search text-[15px] text-gray-400" />
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {products.length > 0 && (
                  <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addToCart(product)}
                        disabled={Number(product.availableStock || product.available_stock || 0) <= 0}
                        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-blue-50/60"
                      >
                        <div>
                          <div className="text-[13px] font-medium text-gray-900">{product.name}</div>
                          <div className="text-[12px] text-gray-500">SKU: {product.sku || '-'}</div>
                          <div className="text-[12px] text-gray-500">Available in source: {Number(product.availableStock || product.available_stock || 0)}</div>
                        </div>
                        <span className="text-[12px] font-medium text-blue-600">Add</span>
                      </button>
                    ))}
                  </div>
                )}

                {products.length === 0 && !loading && (
                  <p className="py-8 text-center text-[13px] text-gray-500">No products found</p>
                )}

                {filteredCart.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Product</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Qty</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">MRP</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Selling</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Cost</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Tax</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCart.map((item) => (
                        <tr key={item.product_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-2 py-3">
                            <div className="text-[13px] font-medium text-gray-900">{item.name}</div>
                            <div className="text-[11px] text-gray-500">{item.sku}</div>
                          </td>
                          <td className="px-2 py-3">
                            <input
                              type="number"
                              min={0.001}
                              step={0.001}
                              inputMode="decimal"
                              value={item.qty}
                              onChange={(e) => updateQty(item.product_id, e.target.value)}
                              className="w-20 rounded border border-gray-200 px-2 py-1 text-[13px] text-gray-700"
                            />
                          </td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.mrp)}</td>
                          <td className="px-2 py-3 text-[13px] font-semibold text-red-700">{formatCurrency(item.selling_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.cost_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.tax_value)}</td>
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() => setCart((current) => current.filter((cartItem) => cartItem.product_id !== item.product_id))}
                              className="rounded p-1.5 text-red-500 hover:bg-red-50"
                            >
                              <i className="ti ti-trash text-[16px]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !searchTerm.trim() && <div className="min-h-[240px]" />
                )}
              </div>
            </section>
          </main>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-[88px] border-t border-gray-200 bg-white shadow-[0_-2px_8px_rgba(15,23,42,0.06)]">
          <div className="flex h-full items-center justify-between px-6 max-md:px-4">
            <div className="flex flex-wrap items-center gap-10">
              <span className="text-[13px] text-gray-600">
                Total Items: <strong className="font-semibold text-gray-900">{totals.totalItems}</strong>
              </span>
              <span className="text-[13px] text-gray-600">
                Total Cost: <strong className="font-semibold text-gray-900">{formatCurrency(totals.totalCost)}</strong>
              </span>
              <span className="text-[13px] text-gray-600">
                Total Tax Value: <strong className="font-semibold text-gray-900">{formatCurrency(totals.totalTax)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={confirming || cart.length === 0}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirming ? 'Confirming...' : 'Confirm Transaction'}
              </button>
              <button
                type="button"
                onClick={() => setCart([])}
                className="rounded-lg border border-gray-200 p-2.5 text-gray-600 transition-colors hover:bg-gray-50"
                title="Clear cart"
              >
                <i className="ti ti-trash text-[18px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-[12px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
