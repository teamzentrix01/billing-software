export const menuItems = [
  { label: 'Home',         icon: 'ti-home',           href: '/home' },

  { label: 'Sales',        icon: 'ti-shopping-bag',   href: '/sales/pos', subSidebar: {
    title: 'Sales & Point of Sale',
    titleIcon: 'ti-shopping-bag',
    groups: [
      {
        label: 'Point of Sale', icon: 'ti-credit-card',
        items: [
          { label: 'POS Interface',    href: '/sales/pos' },
          { label: 'Store Cash Tracking', href: '/sales/store-cash' },
          { label: 'Returns & Exchange', href: '/sales/returns' },
        ],
      },
    ],
  }},

  { label: 'Catalog',      icon: 'ti-layout-grid',    href: '/catalog', subSidebar: {
    title: 'Catalog Dashboard',
    titleIcon: 'ti-layout-dashboard',
    groups: [
      {
        label: 'Product Classification', icon: 'ti-shopping-bag',
        items: [
          { label: 'Category',           href: '/catalog/category' },
          { label: 'Sub Category',       href: '/catalog/sub-category' },
          { label: 'Manufacturer',       href: '/catalog/manufacturer' },
          { label: 'Brand',              href: '/catalog/brand' },
          { label: 'Income Head',        href: '/catalog/income-head' },
          { label: 'Service Group',      href: '/catalog/service-group' },
          { label: 'Department',         href: '/catalog/department' },
          { label: 'Service Department', href: '/catalog/service-department' },
        ],
      },
      {
        label: 'Product', icon: 'ti-building-store',
        items: [
          { label: 'Products',            href: '/catalog/products' },
          { label: 'Product Groups',      href: '/catalog/product-groups' },
          { label: 'Services',            href: '/catalog/services' },
          { label: 'Product Saleability', href: '/catalog/product-saleability' },
        ],
      },
      {
        label: 'Taxes & Charges', icon: 'ti-file-invoice',
        items: [
          { label: 'Taxes',   href: '/catalog/taxes' },
          { label: 'Charges', href: '/catalog/charges' },
        ],
      },
      {
        label: 'Pricing', icon: 'ti-tag',
        items: [
          { label: 'Assign Products To Store',       href: '/catalog/pricing/assign-products-store' },
          { label: 'Assign Products To Warehouse',   href: '/catalog/pricing/assign-products-warehouse' },
          { label: 'Assign Product Groups To Store', href: '/catalog/pricing/assign-groups-store' },
        ],
      },
      {
        label: 'Promotional Products', icon: 'ti-discount',
        items: [
          { label: 'Combos',             href: '/catalog/promos/combos' },
          { label: 'Memberships',        href: '/catalog/promos/memberships' },
          { label: 'Vouchers',           href: '/catalog/promos/vouchers' },
          { label: 'Promotions',         href: '/catalog/promos/promotions' },
          { label: 'Promotion Approval', href: '/catalog/promos/approval' },
        ],
      },
    ],
  }},

  { label: 'Inventory',    icon: 'ti-clipboard-list', href: '/inventory/hub', subSidebar: {
    title: 'Inventory Dashboard',
    titleIcon: 'ti-layout-dashboard',
    groups: [
      {
        label: 'Dashboard', icon: 'ti-layout-dashboard',
        items: [
          { label: 'Inventory Dashboard', href: '/inventory/ops' },
          { label: 'Overview',            href: '/inventory/hub' },
        ],
      },
      {
        label: 'Stock Operations', icon: 'ti-swap-horizontal',
        items: [
          { label: 'Stock In',         href: '/inventory/stockin' },
          { label: 'Stock Out',        href: '/inventory/stockout' },
          { label: 'Stock Transfer',   href: '/inventory/stocktransfer' },
          { label: 'Stock Validation', href: '/inventory/stockvalidation' },
        ],
      },
      {
        label: 'Requisitions & Batches', icon: 'ti-clipboard-list',
        items: [
          { label: 'Stock Requisition', href: '/inventory/stockrequisition' },
          { label: 'Batches',           href: '/inventory/batches' },
          { label: 'Near Expiry',       href: '/inventory/expiry-alerts' },
        ],
      },
    ],
  }},

  { label: 'Purchase',     icon: 'ti-shopping-cart',  href: '/purchase/vendors', subSidebar: {
    title: 'Purchase',
    titleIcon: 'ti-shopping-cart',
    groups: [
      {
        label: 'Vendors & Invoices', icon: 'ti-user-plus',
        items: [
          { label: 'Vendors',            href: '/purchase/vendors' },
          { label: 'Purchase Orders',    href: '/purchase/purchase-orders' },
          { label: 'Quotation Comparison', href: '/purchase/quotations' },
          { label: 'GRN',                href: '/purchase/grn' },
          { label: 'Remote GRN',         href: '/purchase/remote-grn' },
          { label: 'Margin Approvals',   href: '/purchase/margin-approvals' },
          { label: 'Purchase Returns',   href: '/purchase/returns' },
          { label: 'Vendor Invoices',    href: '/purchase/vendor-invoices' },
          { label: 'Invoice Settlement', href: '/purchase/invoice-settlement' },
          { label: 'Vendor Ledger',      href: '/purchase/vendor-ledger' },
          { label: 'Vendor Performance', href: '/purchase/vendor-performance' },
          { label: 'Auto Reorder',       href: '/purchase/auto-reorder' },
        ],
      },
    ],
  }},

  { label: 'Sales Order',  icon: 'ti-receipt', href: '/sales-order/invoice-sales-order', subSidebar: {
    title: 'Sales Order',
    titleIcon: 'ti-receipt',
    groups: [
      {
        label: 'Sales Order', icon: 'ti-file-invoice',
        items: [
          { label: 'Invoice Sales Order',        href: '/sales-order/invoice-sales-order' },
          { label: 'Uninvoiced Sales Order',     href: '/sales-order/uninvoiced-sales-order' },
          { label: 'Bulk Sales Order',           href: '/sales-order/bulk-sales-order' },
          { label: 'Invoice Conversion Tracker', href: '/sales-order/invoice-conversion-tracker' },
          { label: 'Write Off',                  href: '/sales-order/write-off' },
          { label: 'Quotation Pending Approval', href: '/sales-order/quotation-pending-approval' },
          { label: 'Auto Invoice',               href: '/sales-order/auto-invoice' },
        ],
      },
    ],
  }},

  { label: 'Admin', icon: 'ti-shield-lock', href: '/admin/assistant', subSidebar: {
    title: 'Admin Tools',
    titleIcon: 'ti-shield-lock',
    groups: [
      {
        label: 'Intelligence', icon: 'ti-message-chatbot',
        items: [
          { label: 'Admin Assistant', href: '/admin/assistant' },
        ],
      },
    ],
  }},

  { label: 'Employee',     icon: 'ti-user-check', href: '/employee/staff', subSidebar: {
    title: 'Employee',
    titleIcon: 'ti-user-check',
    groups: [
      {
        label: 'Employee', icon: 'ti-users',
        items: [
          { label: 'Employee Departments', href: '/employee/staffdepartments' },
          { label: 'Employees',            href: '/employee/staff' },
          { label: 'User Counter Session', href: '/employee/user-counter-session' },
        ],
      },
    ],
  }},

  { label: 'Customer',     icon: 'ti-users', href: '/customer/dashboard', subSidebar: {
    title: 'Customer',
    titleIcon: 'ti-users',
    groups: [
      {
        label: 'Customer', icon: 'ti-users',
        items: [
          { label: 'Customers Dashboard',           href: '/customer/dashboard' },
          { label: 'List Of Customers',             href: '/customer/list-of-customers' },
          { label: 'Customer Groups',               href: '/customer/customer-groups' },
          { label: 'Inactive Customers',            href: '/customer/inactive-customers' },
          { label: 'Customer Ledger',               href: '/customer/customer-ledger' },
          { label: 'Customer Credit Sale',          href: '/customer/customer-credit-sale' },
          { label: 'Credit Settlement',             href: '/customer/credit-settlement' },
          { label: 'Credit Note History',           href: '/customer/credit-note-history' },
          { label: 'Customers Sales Report',        href: '/customer/customers-sales-report' },
          { label: 'Credit Advanced Configs List',  href: '/customer/credit-advanced-configs-list' },
          { label: 'Credit Advanced Approval',       href: '/customer/credit-advanced-configs-approval' },
          { label: 'Credit Advanced Configuration', href: '/customer/credit-advanced-configuration' },
          { label: 'Unsettled Orders',              href: '/customer/unsettled-orders' },
          { label: 'Customer Advance Payment',      href: '/customer/customer-advance-payment' },
          { label: 'Balance Transfer Tracker',      href: '/customer/balance-transfer-tracker' },
          { label: 'Loyalty Settings',              href: '/customer/loyalty-settings' },
          { label: 'Message History',               href: '/customer/message-history' },
          { label: 'WhatsApp Logs',                 href: '/customer/whatsapp-logs' },
          { label: 'SMS Credit',                    href: '/customer/sms-credit' },
          { label: 'WhatsApp Credit',               href: '/customer/whatsapp-credit' },
        ],
      },
    ],
  }},

  { label: 'Settings', icon: 'ti-settings', href: '/settings', subSidebar: {
    title: 'Settings',
    titleIcon: 'ti-settings',
    groups: [
      {
        label: 'Location Management', icon: 'ti-map-pin',
        items: [
          { label: 'Stores',      href: '/settings/stores' },
          { label: 'Warehouses',  href: '/settings/warehouses' },
          { label: 'Regions',     href: '/settings/regions' },
        ],
      },
      {
        label: 'Device Config', icon: 'ti-device-desktop',
        items: [
          { label: 'Store Device Map',            href: '/settings/device-config/store-device-map' },
          { label: 'Application Device Settings', href: '/settings/device-config/application-device-settings' },
          { label: 'Device Sync Logs',            href: '/settings/device-config/device-sync-logs' },
          { label: 'Device Data Sync',            href: '/settings/device-config/device-data-sync' },
        ],
      },
      {
        label: 'Billing', icon: 'ti-file-invoice',
        items: [
          { label: 'Customize Receipt Print', href: '/settings/billing/customize-receipt-print' },
          { label: 'Remarks',                 href: '/settings/billing/remarks' },
          { label: 'KOT Printer Config',      href: '/settings/billing/kot-printer-config' },
          { label: 'Chain Attributes',        href: '/settings/billing/chain-attributes' },
        ],
      },
      {
        label: 'Inventory', icon: 'ti-clipboard-list',
        items: [
          { label: 'System Attributes', href: '/settings/inventory/system-attributes' },
          { label: 'Custom Attributes', href: '/settings/inventory/custom-attributes' },
          { label: 'Measurement Unit',  href: '/settings/inventory/measurement-unit' },
        ],
      },
      {
        label: 'Payment Configuration', icon: 'ti-credit-card',
        items: [
          { label: 'Chain Payment Settings', href: '/settings/payment/chain-payment-settings' },
          { label: 'Store Payment Settings', href: '/settings/payment/store-payment-settings' },
        ],
      },
      {
        label: 'Credit Note Configuration', icon: 'ti-receipt-refund',
        items: [
          { label: 'Redemption Configuration', href: '/settings/credit-note/redemption-configuration' },
          { label: 'Refund Configuration',     href: '/settings/credit-note/refund-configuration' },
        ],
      },
      {
        label: 'General', icon: 'ti-adjustments',
        items: [
          { label: 'Business Info',        href: '/settings/business-info' },
          { label: 'Receipts (print)',     href: '/settings/receipts-print' },
          { label: 'KOT Printers',        href: '/settings/kot-printers' },
          { label: 'System Attributes',   href: '/settings/system-attributes' },
          { label: 'Custom Attributes',   href: '/settings/custom-attributes' },
          { label: 'Rooms & Tables',      href: '/settings/rooms-tables' },
          { label: 'Sales Targets',       href: '/settings/sales-targets' },
          { label: 'App Settings',        href: '/settings/app-settings' },
          { label: 'Store Payment Modes', href: '/settings/store-payment-modes' },
        ],
      },
    ],
  }},

  { label: 'Reports', icon: 'ti-chart-pie', href: '/reports', subSidebar: {
    title: 'Reports Home',
    titleIcon: 'ti-chart-pie',
    groups: [
      {
        label: 'Pinned', icon: 'ti-pin',
        items: [
          { label: 'Orders List',       href: '/reports/orders-list' },
          { label: 'Daily Sales (DSR)', href: '/reports/daily-sales-dsr' },
          { label: 'Net Sales',         href: '/reports/net-sales' },
          { label: 'Stock Level',       href: '/reports/stock-level' },
        ],
      },
      {
        label: 'Orders', icon: 'ti-shopping-cart',
        items: [
          { label: 'List Of Orders',              href: '/reports/orders/list-of-orders' },
          { label: 'Order Details',               href: '/reports/orders/order-details' },
          { label: 'Order Wise Payment Breakup',  href: '/reports/orders/order-wise-payment-breakup' },
          { label: 'Order Payment History',       href: '/reports/orders/order-payment-history' },
          { label: 'Order Transaction Tracker',   href: '/reports/orders/order-transaction-tracker' },
          { label: 'List Of Void Orders',         href: '/reports/orders/list-of-void-orders' },
          { label: 'Product In Orders',           href: '/reports/orders/product-in-orders' },
          { label: 'Product Transaction Tracker', href: '/reports/orders/product-transaction-tracker' },
          { label: 'Order Combo Report',          href: '/reports/orders/order-combo-report' },
        ],
      },
      {
        label: 'Promotions', icon: 'ti-discount',
        items: [
          { label: 'Product Discount Report',     href: '/reports/promotions/product-discount-report' },
          { label: 'Discount Expenses',           href: '/reports/promotions/discount-expenses' },
          { label: 'Discounted Products',         href: '/reports/promotions/discounted-products' },
          { label: 'Order Discount Report',       href: '/reports/promotions/order-discount-report' },
          { label: 'Coupon Redemption',           href: '/reports/promotions/coupon-redemption' },
          { label: 'Discount Performance Report', href: '/reports/promotions/discount-performance-report' },
          { label: 'Membership Tracker',          href: '/reports/promotions/membership-tracker' },
          { label: 'Membership Purchase History', href: '/reports/promotions/membership-purchase-history' },
        ],
      },
      {
        label: 'Proforma Invoices', icon: 'ti-file-invoice',
        items: [
          { label: 'List of PI',                          href: '/reports/proforma-invoices/list-of-pi' },
          { label: 'PI Detail',                           href: '/reports/proforma-invoices/pi-detail' },
          { label: 'Product in PI',                       href: '/reports/proforma-invoices/product-in-pi' },
          { label: 'PI Product Level Discount',           href: '/reports/proforma-invoices/pi-product-level-discount' },
          { label: 'PI Payment Breakup',                  href: '/reports/proforma-invoices/pi-payment-breakup' },
          { label: 'PI Payment History',                  href: '/reports/proforma-invoices/pi-payment-history' },
          { label: 'PI Product Sale Transaction Tracker', href: '/reports/proforma-invoices/pi-product-sale-transaction-tracker' },
        ],
      },
      {
        label: 'Sales', icon: 'ti-trending-up',
        items: [
          { label: 'Daily Sales',                 href: '/reports/sales/daily-sales' },
          { label: 'Location Wise Sales',         href: '/reports/sales/location-wise-sales' },
          { label: 'Region Wise Sales',           href: '/reports/sales/region-wise-sales' },
          { label: 'Store Wise Sales',            href: '/reports/sales/store-wise-sales' },
          { label: 'Store Wise Product Sales',    href: '/reports/sales/store-wise-product-sales' },
          { label: 'Device Wise Sales',           href: '/reports/sales/device-wise-sales' },
          { label: 'Customer Wise Sales',         href: '/reports/sales/customer-wise-sales' },
          { label: 'Employee Wise Sales',         href: '/reports/sales/employee-wise-sales' },
          { label: 'Employee Wise Product Sales', href: '/reports/sales/employee-wise-product-sales' },
          { label: 'Store Hourly Sales',          href: '/reports/sales/store-hourly-sales' },
          { label: 'Daily Payment Breakup',       href: '/reports/sales/daily-payment-breakup' },
          { label: 'Entity Wise Sales',           href: '/reports/sales/entity-wise-sales' },
          { label: 'Product Wise Sales',          href: '/reports/sales/product-wise-sales' },
          { label: 'Department Wise Sales',       href: '/reports/sales/department-wise-sales' },
          { label: 'Category Wise Sales',         href: '/reports/sales/category-wise-sales' },
          { label: 'Sub Category Wise Sales',     href: '/reports/sales/sub-category-wise-sales' },
          { label: 'Brand Wise Sales',            href: '/reports/sales/brand-wise-sales' },
          { label: 'Income Head Wise Sales',      href: '/reports/sales/income-head-wise-sales' },
          { label: 'Fiscal Report',               href: '/reports/sales/fiscal-report' },
        ],
      },
      {
        label: 'Online Order', icon: 'ti-world',
        items: [
          { label: 'List Of Online Orders',     href: '/reports/online-order/list-of-online-orders' },
          { label: 'Online Order Detail',       href: '/reports/online-order/online-order-detail' },
          { label: 'Product In Online Orders',  href: '/reports/online-order/product-in-online-orders' },
          { label: 'Product Wise Online Sales', href: '/reports/online-order/product-wise-online-sales' },
        ],
      },
      {
        label: 'Inventory', icon: 'ti-clipboard-list',
        items: [
          { label: 'Stock Level',                 href: '/reports/inventory/stock-level' },
          { label: 'Store Wise Stock Level',      href: '/reports/inventory/store-wise-stock-level' },
          { label: 'Product Group Stock Level',   href: '/reports/inventory/product-group-stock-level' },
          { label: 'Stock Operations',            href: '/reports/inventory/stock-operations' },
          { label: 'Stock Operations Detail',     href: '/reports/inventory/stock-operations-detail' },
          { label: 'Stock Requisition',           href: '/reports/inventory/stock-requisition' },
          { label: 'Unfulfilled Stock Requests',  href: '/reports/inventory/unfulfilled-stock-requests' },
          { label: 'Unfulfilled Stock Transfers', href: '/reports/inventory/unfulfilled-stock-transfers' },
          { label: 'Product Ageing Report',       href: '/reports/inventory/product-ageing-report' },
          { label: 'Profit Margin',               href: '/reports/inventory/profit-margin' },
          { label: 'Low Stock Products',          href: '/reports/inventory/low-stock-products' },
          { label: 'Stock Ledger Summary',        href: '/reports/inventory/stock-ledger-summary' },
          { label: 'Stock Movement',              href: '/reports/inventory/stock-movement' },
          { label: 'Stock Movement Detail',       href: '/reports/inventory/stock-movement-detail' },
          { label: 'Stock Fulfillment',           href: '/reports/inventory/stock-fulfillment' },
        ],
      },
      {
        label: 'Insights', icon: 'ti-bulb',
        items: [
          { label: 'ABC-XYZ Classification',      href: '/reports/insights/abc-xyz-classification' },
          { label: 'Inventory Accuracy Scorecard', href: '/reports/insights/inventory-accuracy-scorecard' },
          { label: 'Dead Stock Detector',          href: '/reports/insights/dead-stock-detector' },
          { label: 'Stockout Predictor',           href: '/reports/insights/stockout-predictor' },
          { label: 'Smart Reorder',                href: '/reports/insights/smart-reorder' },
          { label: 'GMROI Capital Efficiency',     href: '/reports/insights/gmroi-capital-efficiency' },
          { label: 'Bill-Level Margin Monitor',    href: '/reports/insights/bill-level-margin-monitor' },
          { label: 'Revenue Leakage Detector',     href: '/reports/insights/revenue-leakage-detector' },
          { label: 'Discount & Margin Analyzer',   href: '/reports/insights/discount-margin-analyzer' },
          { label: 'Basket & Affinity Insights',   href: '/reports/insights/basket-affinity-insights' },
          { label: 'POS Cash Variance Alerts',     href: '/reports/insights/pos-cash-variance-alerts' },
          { label: 'Purchase Price Variance',      href: '/reports/insights/purchase-price-variance' },
          { label: 'Fulfillment Leakage Tracker',  href: '/reports/insights/fulfillment-leakage-tracker' },
          { label: 'Store Peer Benchmarking',      href: '/reports/insights/store-peer-benchmarking' },
        ],
      },
      {
        label: 'Accounting Reports', icon: 'ti-calculator',
        items: [
          { label: 'Order Wise Tax Breakup',   href: '/reports/accounting/order-wise-tax-breakup' },
          { label: 'Product Wise Tax Breakup', href: '/reports/accounting/product-wise-tax-breakup' },
          { label: 'HSN/SAC Wise Tax Breakup', href: '/reports/accounting/hsn-sac-wise-tax-breakup' },
        ],
      },
      {
        label: 'Purchase', icon: 'ti-shopping-cart',
        items: [
          { label: 'List Of Purchase Orders',         href: '/reports/purchase/list-of-purchase-orders' },
          { label: 'Product In Purchase Orders',      href: '/reports/purchase/product-in-purchase-orders' },
          { label: 'Purchase Order Details',          href: '/reports/purchase/purchase-order-details' },
          { label: 'Vendor Tax Input',                href: '/reports/purchase/vendor-tax-input' },
          { label: 'Vendor Purchase Summary',         href: '/reports/purchase/vendor-purchase-summary' },
          { label: 'Vendor Product Purchase Summary', href: '/reports/purchase/vendor-product-purchase-summary' },
          { label: 'Vendor Quotation Comparison',     href: '/reports/purchase/vendor-quotation-comparison' },
          { label: 'Purchase Return Report',          href: '/reports/purchase/purchase-return-report' },
          { label: 'Vendor Ledger Report',            href: '/reports/purchase/vendor-ledger-report' },
          { label: 'Vendor Performance Report',       href: '/reports/purchase/vendor-performance-report' },
          { label: 'Auto Reorder Suggestions',        href: '/reports/purchase/auto-reorder-suggestions' },
        ],
      },
      {
        label: 'Custom Reports', icon: 'ti-adjustments',
        items: [
          { label: 'ELR Report',          href: '/reports/custom/elr-report' },
          { label: 'Daily Sales Summary', href: '/reports/custom/daily-sales-summary' },
        ],
      },
      {
        label: 'Logs', icon: 'ti-history',
        items: [
          { label: 'Product Logs',       href: '/reports/logs/product-logs' },
          { label: 'System Change Logs', href: '/reports/logs/system-change-logs' },
          { label: 'Order Sync Logs',    href: '/reports/logs/order-sync-logs' },
          { label: 'Audit Trail',        href: '/reports/logs/audit-trail' },
        ],
      },
    ],
  }},
];
