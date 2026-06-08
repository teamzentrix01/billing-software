import ReportsListPage from '@/components/ReportListPage';

const filters = [
  { key: 'date_range', label: 'Date Range',     type: 'date-range' },
  { key: 'region',     label: 'Select Region',  type: 'text' },
  { key: 'store',      label: 'Store',          type: 'select', options: [] },
  { key: 'product',    label: 'Product',        type: 'text', placeholder: 'Search product...' },
];

const columns = [
  { key: 'product',       label: 'Product'       },
  { key: 'sku',           label: 'SKU'           },
  { key: 'store',         label: 'Store'         },
  { key: 'stock_in',      label: 'Stock In'      },
  { key: 'stock_out',     label: 'Stock Out'     },
  { key: 'current_stock', label: 'Current Stock' },
  { key: 'unit',          label: 'Unit'          },
  { key: 'status',        label: 'Status'        },
];

export default function StockLevelPage() {
  return (
    <ReportsListPage
      breadcrumbs={[
        { label: 'Reports Dashboard', href: '/reports' },
        { label: 'Pinned' },
        { label: 'Stock Level' },
      ]}
      title="Stock Level"
      description="Current stock levels across all stores"
      filters={filters}
      columns={columns}
      reportKey="stock-level"
    />
  );
}
