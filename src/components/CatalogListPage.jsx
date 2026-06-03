'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import {
  OPTIONS_SHEET_NAME,
  addOptionNamedRanges,
  buildOptionsSheet,
  hideOptionsSheet,
  optionFormula,
  prefixMatchOptionFormula,
  saveWorkbookWithValidations,
} from '@/lib/xlsxDropdowns';

const PAGE_SIZES = [10, 25, 50, 100];
const TEMPLATE_ROW_LIMIT = 5001;
const EXCEL_CELL_TEXT_LIMIT = 32767;
const PRODUCT_TAX_COLUMNS = [
  '1-CGST-2.5%',
  '2-SGST-2.5%',
  '3-IGST-5%',
  '4-CGST-6%',
  '5-SGST-6%',
  '6-IGST-12%',
  '7-CGST-9%',
  '8-SGST-9%',
  '9-IGST-18%',
  '10-CGST-14%',
  '11-SGST-14%',
  '12-IGST-28%',
  '13-CGST-20%',
  '14-SGST-20%',
  '15-IGST-40%',
];
const PRODUCT_ATTRIBUTE_COLUMNS = [
  'Use Attribute MRP',
  'Use attribute - Cost Price',
  'Use attribute - Expiry Date',
];
const REQUIRED_PRODUCT_TEMPLATE_HEADERS = new Set(['Product Name', 'Selling Price', 'Unit']);

async function fetchOptionNames(url, labelFields = ['name']) {
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return [];
    return [...new Set((json.data?.records || [])
      .map((record) => {
        for (const field of labelFields) {
          const value = String(record[field] || '').trim();
          if (value) return value;
        }
        return '';
      })
      .filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

async function fetchStoresForTemplate() {
  try {
    const res = await fetch('/api/stores');
    const json = await res.json();
    if (!json.success) return [];
    return [...new Set((json.data?.stores || [])
      .map((store) => String(store.name || '').trim())
      .filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function parseProductTaxHeader(header) {
  const match = String(header || '').match(/^\d+-(CGST|SGST|IGST)-([\d.]+)%$/i);
  if (!match) return null;
  return { type: match[1].toUpperCase(), rate: Number(match[2]) };
}

function productTaxColumnMatchesRecord(header, record) {
  const parsed = parseProductTaxHeader(header);
  if (!parsed || !record) return false;
  const taxName = String(record.tax_name || record.tax || '').toUpperCase();
  const taxRate = Number(record.tax_rate ?? record.rate ?? NaN);
  const nameHasType = taxName.includes(parsed.type);
  const nameHasRate = taxName.includes(`${parsed.rate}%`) || taxName.includes(String(parsed.rate));
  const rateMatches = Number.isFinite(taxRate) && Math.abs(taxRate - parsed.rate) < 0.001;
  if (nameHasType && (nameHasRate || rateMatches)) return true;
  return !taxName && rateMatches;
}

export default function CatalogListPage({
  breadcrumbs = [],
  title = '',
  description = '',
  filters = null,
  createLabel = null,
  onCreateClick,
  bulkOperations = true,
  bulkImportType = null, // 'categories' | 'sub-categories'
  endpoint = '',
  extraQueryParams = null,
  columns = [],
  rows = [],
  loading = false,
  totalLabel = 'Record(s)',
  emptyMessage = 'No Records Found',
  page = 1,
  pageSize = 10,
  totalPages = 1,
  total = 0,
  onPageChange,
  onPageSizeChange,
  search = '',
  onSearchChange,
  showRowActions = false,
  onEdit,
  onDelete,
  showStoreSelector = false,
  selectorLabel = null,
  selectorPlaceholder = 'None',
  stores = [],
  onStoreChange,
  onImportSuccess,
}) {
  const [checkedRows, setCheckedRows]   = useState([]);
  const [allChecked, setAllChecked]     = useState(false);
  const [storeVal, setStoreVal]         = useState('');
  const [bulkOpen, setBulkOpen]         = useState(false);
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [toast, setToast]               = useState(null);
  const fileRef                         = useRef();

  const isControlled  = !!onPageChange;
  const curPage       = isControlled ? page     : 1;
  const curPageSize   = isControlled ? pageSize : 10;
  const curSearch     = onSearchChange ? search : '';
  const curTotal      = total || rows.length;
  const curTotalPages = totalPages || Math.ceil(rows.length / curPageSize);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSearch = (val) => { if (onSearchChange) onSearchChange(val); };
  const handlePageChange = (p) => { if (onPageChange) onPageChange(p); };
  const handlePageSizeChange = (s) => { if (onPageSizeChange) onPageSizeChange(s); };

  const handleAllCheck = () => {
    if (allChecked) { setCheckedRows([]); setAllChecked(false); }
    else { setCheckedRows(rows.map(r => r.id)); setAllChecked(true); }
  };

  const displayRows = isControlled ? rows : rows
    .filter(r => !curSearch || Object.values(r).some(v =>
      String(v).toLowerCase().includes(curSearch.toLowerCase())
    ))
    .slice((curPage - 1) * curPageSize, curPage * curPageSize);

  const pageButtons = () => {
    if (curTotalPages <= 7) return Array.from({ length: curTotalPages }, (_, i) => i + 1);
    if (curPage <= 4) return [1,2,3,4,5,'…',curTotalPages];
    if (curPage >= curTotalPages - 3) return [1,'…',curTotalPages-4,curTotalPages-3,curTotalPages-2,curTotalPages-1,curTotalPages];
    return [1,'…',curPage-1,curPage,curPage+1,'…',curTotalPages];
  };

  const getTemplateFileName = () => {
    if (bulkImportType === 'products') return 'products-import-template.xlsx';
    return `${bulkImportType || 'import'}-template.xlsx`;
  };

  const fetchTemplateRecords = async () => {
    if (!endpoint) return rows;
    const params = new URLSearchParams({ page: '1', pageSize: String(Math.min(Math.max(total || rows.length || 5000, 5000), 10000)) });
    try {
      const response = await fetch(`${endpoint}?${params.toString()}`);
      const json = await response.json();
      return json.success ? (json.data?.records || []) : rows;
    } catch {
      return rows;
    }
  };

    const getTemplateCellValue = (record, header) => {
    if (!record) return '';
    if (header === 'image_url') return '';
    if (PRODUCT_TAX_COLUMNS.includes(header)) return productTaxColumnMatchesRecord(header, record) ? 'Yes' : 'No';
    if (PRODUCT_ATTRIBUTE_COLUMNS.includes(header)) return '';
    const direct = record[header];
    let value = '';
    if (direct !== undefined && direct !== null) value = direct;
    else if (header === 'category_name') value = record.category_name || record.category || '';
    else if (header === 'sub_category_name') value = record.sub_category_name || record.subCategory || '';
    else if (header === 'brand_name') value = record.brand_name || record.brand || '';
    else if (header === 'manufacturer_name') value = record.manufacturer_name || record.manufacturer || '';
    else if (header === 'department_name') value = record.department_name || record.department || '';
    else if (header === 'tax_name') value = record.tax_name || record.tax || '';
    else if (header === 'inventory_store_name') value = record.inventory_store_name || record.store_name || '';
    else if (header === 'selling_price') value = record.selling_price ?? String(record.price || '').replace(/[^0-9.]/g, '');
    if (typeof value !== 'string') return value;
    return value.length > EXCEL_CELL_TEXT_LIMIT ? value.slice(0, EXCEL_CELL_TEXT_LIMIT) : value;
  };

  // ── Download template ──────────────────────────────────────
  const downloadTemplate = async () => {
    try {
    const productTemplateHeaders = [
      'Product Name',
      'Product Code',
      'Brand',
      'Category',
      'Sub Category',
      'Income Head',
      'Unit',
      'Price Includes Tax',
      'Manage Inventory',
      'Stock Item Type',
      'Is Sellable On POS',
      'Allow Variable Pricing',
      'Allow Discount On POS',
      'HSN/SAC Code',
      'Selling Price',
      'MRP',
      'Cost Price',
      'Barcode',
      'SKU',
      'Description',
      ...PRODUCT_TAX_COLUMNS,
      ...PRODUCT_ATTRIBUTE_COLUMNS,
      'Opening Stock Store',
      'Opening Stock Qty',
      'Default Low Stock Value',
      'Disable Billing On Zero',
      'Disable Sales On Expiry',
      'Inventory Method',
    ];
    const baseHeaders = bulkImportType === 'categories'
      ? ['name', 'description', 'sort_sequence', 'is_active']
      : bulkImportType === 'sub-categories'
        ? ['name', 'category_name', 'description', 'sort_sequence', 'is_active']
      : bulkImportType === 'product-groups'
        ? ['name', 'description', 'category_name', 'is_active']
        : productTemplateHeaders;

    const displayHeader = (header) =>
      bulkImportType === 'products' && REQUIRED_PRODUCT_TEMPLATE_HEADERS.has(header)
        ? `✓ ${header}`
        : header;
    const cleanHeader = (header) => String(header || '').replace(/^✓\s*/, '').trim();
    const headers = baseHeaders.map(displayHeader);
    const requiredHeaders = new Set(bulkImportType === 'products'
      ? [...REQUIRED_PRODUCT_TEMPLATE_HEADERS].map(displayHeader)
      : ['name']);
    const templateRecords = await fetchTemplateRecords();
    const productValueMap = {
      'Product Name': 'name',
      'Product Code': 'product_id',
      Brand: 'brand_name',
      Category: 'category_name',
      'Sub Category': 'sub_category_name',
      'Income Head': 'income_head_name',
      Unit: 'unit',
      'Price Includes Tax': 'include_tax',
      'Manage Inventory': 'manage_inventory_enabled',
      'Stock Item Type': 'stock_item_type',
      'Is Sellable On POS': 'is_sellable_on_pos',
      'Allow Variable Pricing': 'allow_variable_pricing',
      'Allow Discount On POS': 'allow_discount_on_pos',
      'HSN/SAC Code': 'hsn_code',
      'Selling Price': 'selling_price',
      MRP: 'mrp',
      'Cost Price': 'cost_price',
      Barcode: 'barcode',
      SKU: 'sku',
      Description: 'description',
      'Opening Stock Store': 'inventory_store_name',
      'Opening Stock Qty': 'opening_stock_qty',
      'Default Low Stock Value': 'default_low_stock_value',
      'Disable Billing On Zero': 'disable_billing_on_zero',
      'Disable Sales On Expiry': 'disable_sales_on_expiry',
      'Inventory Method': 'inventory_method',
    };
    const dataRows = templateRecords.map((record) => headers.map((header) => {
      const normalizedHeader = cleanHeader(header);
      return getTemplateCellValue(record, productValueMap[normalizedHeader] || normalizedHeader);
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    headers.forEach((header, index) => {
      const headerRef = XLSX.utils.encode_cell({ r: 0, c: index });
      if (ws[headerRef]) {
        ws[headerRef].s = { font: { bold: true, color: { rgb: requiredHeaders.has(header) ? '9F1239' : '111827' } } };
      }
    });
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const optionGroups = bulkImportType === 'products' ? [
      { key: 'brands', values: await fetchOptionNames('/api/catalog/brands?pageSize=1000') },
      { key: 'categories', values: await fetchOptionNames('/api/catalog/categories?pageSize=1000') },
      { key: 'sub_categories', values: await fetchOptionNames('/api/catalog/sub-categories?pageSize=1000') },
      { key: 'income_heads', values: await fetchOptionNames('/api/catalog/income-heads?pageSize=1000') },
      { key: 'stores', values: await fetchStoresForTemplate() },
    ] : [];
    const headerIndex = (label) => headers.findIndex((header) => cleanHeader(header) === label);
    const includeTaxCol = headerIndex('Price Includes Tax');
    const unitCol = headerIndex('Unit');
    const inventoryMethodCol = headerIndex('Inventory Method');
    const stockTypeCol = headerIndex('Stock Item Type');
    const booleanCols = [
      'Price Includes Tax',
      'Manage Inventory',
      'Is Sellable On POS',
      'Allow Variable Pricing',
      'Allow Discount On POS',
      'Disable Billing On Zero',
      'Disable Sales On Expiry',
      ...PRODUCT_TAX_COLUMNS,
      ...PRODUCT_ATTRIBUTE_COLUMNS,
    ].map((header) => headerIndex(header)).filter((index) => index >= 0);
    const validations = [];
    const addValidation = (col, formula) => {
      if (col < 0 || !formula) return;
      validations.push({
        range: `${XLSX.utils.encode_col(col)}2:${XLSX.utils.encode_col(col)}${TEMPLATE_ROW_LIMIT}`,
        formula,
      });
    };
    for (const col of booleanCols) addValidation(col, '"Yes,No"');
    addValidation(unitCol, '"PCS,KG,LTR"');
    addValidation(includeTaxCol, '"Yes,No"');
    addValidation(inventoryMethodCol, '"direct,indirect"');
    addValidation(stockTypeCol, '"batched,unbatched"');
    if (bulkImportType === 'products') {
      const addPrefixValidation = (header, optionKey) => {
        const col = headerIndex(header);
        if (col < 0) return;
        addValidation(col, prefixMatchOptionFormula(optionGroups, optionKey, `${XLSX.utils.encode_col(col)}2`));
      };
      addPrefixValidation('Brand', 'brands');
      addPrefixValidation('Category', 'categories');
      addPrefixValidation('Sub Category', 'sub_categories');
      addPrefixValidation('Income Head', 'income_heads');
      addPrefixValidation('Opening Stock Store', 'stores');
    }
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    if (bulkImportType === 'products' && optionGroups.some((group) => group.values.length)) {
      XLSX.utils.book_append_sheet(wb, buildOptionsSheet(optionGroups), OPTIONS_SHEET_NAME);
      addOptionNamedRanges(wb, optionGroups);
      hideOptionsSheet(wb);
    }
    if (bulkImportType === 'products') {
      const info = XLSX.utils.aoa_to_sheet([
        ['Field', 'Requirement / allowed values'],
        ['Product Name', 'Required'],
        ['Selling Price', 'Required'],
        ['Unit', 'Required: PCS, KG, or LTR'],
        ['include_tax', 'Yes/No. Use Yes when GST is already included in selling_price.'],
        ['GST', optionFormula(optionGroups, 'taxes') ? 'Choose from dropdown. Required when Price Includes Tax is Yes.' : 'Required when Price Includes Tax is Yes. Must match an existing GST slab name.'],
        ['stock_item_type', 'batched/unbatched'],
      ]);
      XLSX.utils.book_append_sheet(wb, info, 'Instructions');
    }
    if (validations.length) {
      await saveWorkbookWithValidations(wb, getTemplateFileName(), validations);
    } else {
      XLSX.writeFile(wb, getTemplateFileName());
    }
    setBulkOpen(false);
    } catch (err) {
      console.error('Template download failed:', err);
      showToast('Template download failed', 'error');
    }
  };

  // ── Handle Excel file upload ───────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileRef.current.value = '';
    setBulkOpen(false);
    setImporting(true);

    try {
      const data   = await file.arrayBuffer();
      const wb     = XLSX.read(data);
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const previewRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
      const firstRow = (previewRows[0] || []).map((cell) => String(cell).trim().toLowerCase());
      const startsWithRequirementRow = firstRow.some((cell) => cell === 'required' || cell === 'optional');
      const parsed = XLSX.utils.sheet_to_json(ws, { defval: '', range: startsWithRequirementRow ? 1 : 0 });

      if (!parsed.length) {
        showToast('Excel file is empty', 'error');
        setImporting(false);
        return;
      }

      const res  = await fetch('/api/catalog/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: bulkImportType, rows: parsed }),
      });
      const json = await res.json();

      if (json.success) {
        setImportResult(json.data);
        showToast(`${json.data.inserted} records imported successfully!`);
        onImportSuccess?.();
      } else {
        showToast(json.message || 'Import failed', 'error');
      }
    } catch (err) {
      showToast('Failed to read file', 'error');
    } finally {
      setImporting(false);
    }
  };

  const bulkMenuItems = bulkImportType === 'products'
    ? [
        { label: 'Import Products (Excel)', action: () => fileRef.current?.click() },
        { label: 'Download Template', action: downloadTemplate },
        { label: 'Export Products', action: () => {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, title);
            XLSX.writeFile(wb, `${title.toLowerCase().replace(' ', '-')}-export.xlsx`);
            setBulkOpen(false);
          }
        },
      ]
    : bulkImportType === 'product-groups'
      ? [
          { label: 'Import Product Groups (Excel)', action: () => fileRef.current?.click() },
          { label: 'Download Template', action: downloadTemplate },
          { label: 'Export Product Groups', action: () => {
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, title);
              XLSX.writeFile(wb, `${title.toLowerCase().replace(' ', '-')}-export.xlsx`);
              setBulkOpen(false);
            }
          },
        ]
    : [
        ...(bulkImportType ? [
          { label: `Create ${title}`,          action: onCreateClick },
          { label: `Import ${title} (Excel)`,  action: () => fileRef.current?.click() },
          { label: `Download Template`,        action: downloadTemplate },
          { label: `Export ${title}`,          action: () => {
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, title);
              XLSX.writeFile(wb, `${title.toLowerCase().replace(' ', '-')}-export.xlsx`);
              setBulkOpen(false);
            }
          },
        ] : [
          { label: `Create ${title}`,   action: onCreateClick },
          { label: `Edit ${title}`,     action: null },
          { label: `Export ${title}`,   action: () => {
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, title);
              XLSX.writeFile(wb, `${title.toLowerCase().replace(' ', '-')}-export.xlsx`);
              setBulkOpen(false);
            }
          },
        ]),
      ];

  const importErrors = Array.isArray(importResult?.errors) ? importResult.errors : [];
  const groupedImportErrors = importErrors.reduce((acc, item) => {
    const message = (item?.error || 'Unknown import error').trim();
    const rowName = (item?.row || '').trim();

    if (!acc[message]) {
      acc[message] = { message, count: 0, samples: [] };
    }

    acc[message].count += 1;
    if (rowName && acc[message].samples.length < 4 && !acc[message].samples.includes(rowName)) {
      acc[message].samples.push(rowName);
    }

    return acc;
  }, {});

  const groupedImportErrorsList = Object.values(groupedImportErrors)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen bg-gray-100 p-3 font-sans text-sm text-gray-800 sm:p-5 md:p-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[999] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all
          ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload}/>

      {/* Import loading overlay */}
      {importing && (
        <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/30 px-4">
          <div className="flex max-w-full items-center gap-3 rounded-xl bg-white px-5 py-5 shadow-xl sm:px-8 sm:py-6">
            <svg className="animate-spin w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                strokeDasharray="32" strokeDashoffset="12"/>
            </svg>
            <span className="text-sm font-medium text-gray-700">Importing data...</span>
          </div>
        </div>
      )}

      {/* Import Result Modal */}
      {importResult && (
        <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/30 px-4">
          <div className="max-h-[90vh] w-[min(92vw,560px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start gap-3">
              <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full ${importErrors.length ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                <span className="text-base font-bold">{importErrors.length ? '!' : '✓'}</span>
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">Import Complete</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {importErrors.length
                    ? 'Some rows could not be imported. Please review the reasons below.'
                    : 'All rows imported successfully.'}
                </p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Imported</p>
                <p className="mt-1 text-lg font-extrabold text-emerald-700">{importResult.inserted}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Skipped</p>
                <p className="mt-1 text-lg font-extrabold text-amber-700">{importResult.skipped}</p>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Errors</p>
                <p className="mt-1 text-lg font-extrabold text-rose-700">{importErrors.length}</p>
              </div>
            </div>

            {importErrors.length > 0 && (
              <div className="mb-4 space-y-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Tip: Fix the listed reasons in your Excel file, then re-upload.
                </div>

                <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {groupedImportErrorsList.map((group, index) => (
                    <div key={`${group.message}-${index}`} className="rounded-lg border border-slate-200 bg-white p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] font-semibold text-slate-800">{group.message}</p>
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 whitespace-nowrap">
                          {group.count} row{group.count > 1 ? 's' : ''}
                        </span>
                      </div>
                      {group.samples.length > 0 && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Example: {group.samples.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">Show full row-wise error details</summary>
                  <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
                    {importErrors.map((e, i) => (
                      <p key={i} className="text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-800">{e.row}:</span> {e.error}
                      </p>
                    ))}
                  </div>
                </details>
              </div>
            )}

            <button
              onClick={() => setImportResult(null)}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-400">›</span>}
            {crumb.href
              ? <Link href={crumb.href} className="text-blue-500 hover:underline">{crumb.label}</Link>
              : <span className="text-gray-700 font-medium">{crumb.label}</span>}
          </span>
        ))}
      </nav>

      {/* Header */}
      <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          {description && (
            <p className="text-xs text-gray-500 mt-1">
              {description.replace('Need Help?', '')}
              {description.includes('Need Help?') && (
                <a href="#" className="text-blue-500 hover:underline">Need Help?</a>
              )}
            </p>
          )}
        </div>
        <div className="relative flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {bulkOperations && (
            <div className="relative">
              <button
                onClick={() => setBulkOpen(o => !o)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto">
                Bulk Operations
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>

              {bulkOpen && (
                <>
                  {/* Backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setBulkOpen(false)}/>
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                    {bulkMenuItems.map((item, i) => (
                      <button key={i}
                        onClick={() => { item.action?.(); if (item.label !== `Import ${title} (Excel)`) setBulkOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                        {item.label === `Import ${title} (Excel)` && (
                          <span className="inline-block w-4 h-4 mr-2 text-green-600">↑</span>
                        )}
                        {item.label === 'Download Template' && (
                          <span className="inline-block w-4 h-4 mr-2 text-blue-500">↓</span>
                        )}
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {createLabel && (
            <button onClick={onCreateClick}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 sm:w-auto">
              <span className="text-base leading-none">+</span>
              {createLabel}
            </button>
          )}
        </div>
      </div>

      {filters && (
        <div className="mb-5">
          {filters}
        </div>
      )}

      {/* Store Selector */}
      {showStoreSelector && (
        <div className="mb-5">
          {selectorLabel && (
            <label className="block text-sm font-medium text-gray-700 mb-1">{selectorLabel}</label>
          )}
          <div className="relative block w-full sm:inline-block sm:w-auto">
            <select value={storeVal}
              onChange={e => { setStoreVal(e.target.value); onStoreChange?.(e.target.value); }}
              className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-56">
              <option value="">{selectorPlaceholder}</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
          </div>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex justify-end border-b border-gray-100 px-3 py-3 sm:px-4">
          <div className="relative w-full sm:w-auto">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 20 20">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M15 15l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input type="text" placeholder="Search" value={curSearch}
              onChange={e => handleSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-60"/>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allChecked} onChange={handleAllCheck}
                    className="w-4 h-4 accent-blue-600 cursor-pointer rounded"/>
                </th>
                {columns.map(col => (
                  <th key={col.key} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">
                    {col.label}
                    {col.sortable !== false && (
                      <span className="ml-1 text-gray-300 text-xs">↑↓</span>
                    )}
                  </th>
                ))}
                {showRowActions && <th className="px-4 py-3 w-20"></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length + (showRowActions ? 2 : 1)} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-gray-400">
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                          strokeDasharray="32" strokeDashoffset="12"/>
                      </svg>
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + (showRowActions ? 2 : 1)} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <svg className="w-10 h-10 opacity-40" viewBox="0 0 40 40" fill="none">
                        <rect x="4" y="8" width="32" height="26" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M4 14h32M13 8v6M27 8v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M12 22h6M12 28h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <span className="text-sm">{emptyMessage}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                displayRows.map(row => (
                  <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox"
                        checked={checkedRows.includes(row.id)}
                        onChange={() => setCheckedRows(prev =>
                          prev.includes(row.id) ? prev.filter(r => r !== row.id) : [...prev, row.id]
                        )}
                        className="w-4 h-4 accent-blue-600 cursor-pointer rounded"/>
                    </td>
                    {columns.map(col => (
                      <td key={col.key} className="px-4 py-3 text-gray-700">
                        {col.key === 'sno' ? (
                          <span className="text-blue-600 font-medium">{row[col.key]}</span>
                        ) : col.key === 'is_active' ? (
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium
                            ${row[col.key] === true || row[col.key] === 'Active'
                              ? 'bg-green-50 text-green-600'
                              : 'bg-red-50 text-red-500'}`}>
                            {row[col.key] === true ? 'Active' : row[col.key] === false ? 'Inactive' : row[col.key]}
                          </span>
                        ) : (
                          <span>{row[col.key] ?? '—'}</span>
                        )}
                      </td>
                    ))}
                    {showRowActions && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {onEdit && (
                            <button onClick={() => onEdit(row)}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors">
                              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
                                <path d="M13 3l4 4-9 9H4v-4l9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          )}
                          {onDelete && (
                            <button onClick={() => onDelete(row)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
                                <path d="M6 2h8M4 5h12l-1.5 12H5.5L4 5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <select value={curPageSize}
                onChange={e => handlePageSizeChange(Number(e.target.value))}
                className="appearance-none border border-gray-300 rounded-lg px-3 py-1.5 pr-7 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
            </div>
            <span className="text-xs text-gray-500">
              Showing {displayRows.length
                ? `${(curPage - 1) * curPageSize + 1} to ${Math.min(curPage * curPageSize, curTotal)}`
                : '0 to 0'} of {curTotal} {totalLabel}
            </span>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-1">
            <button onClick={() => handlePageChange(Math.max(1, curPage - 1))}
              disabled={curPage === 1}
              className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {pageButtons().map((p, i) => (
              p === '…'
                ? <span key={`e${i}`} className="w-8 text-center text-gray-400">…</span>
                : <button key={p} onClick={() => handlePageChange(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium border transition
                      ${p === curPage
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'}`}>
                    {p}
                  </button>
            ))}
            <button onClick={() => handlePageChange(Math.min(curTotalPages, curPage + 1))}
              disabled={curPage === curTotalPages}
              className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
