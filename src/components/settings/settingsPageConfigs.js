const yesNoOptions = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

const paymentModeOptions = [
  { label: 'Cash', value: 'cash' },
  { label: 'Card', value: 'card' },
  { label: 'UPI', value: 'upi' },
  { label: 'Credit', value: 'credit' },
  { label: 'Wallet', value: 'wallet' },
];

export const settingsPageConfigs = {
  businessInfo: {
    type: 'business-info',
    title: 'Business Info',
    description: 'Manage legal name, GSTIN, logo, contact, and registration details.',
    fields: [
      { key: 'legalName', label: 'Legal Name' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address', type: 'textarea' },
    ],
  },
  appSettings: {
    type: 'app-settings',
    title: 'App Settings',
    description: 'Configure app-level defaults and operational preferences.',
    fields: [
      { key: 'timezone', label: 'Timezone', defaultValue: 'Asia/Kolkata' },
      { key: 'currency', label: 'Currency', defaultValue: 'INR' },
      { key: 'dateFormat', label: 'Date Format', defaultValue: 'DD/MM/YY' },
      { key: 'allowOfflineBilling', label: 'Allow Offline Billing', type: 'checkbox', defaultValue: true },
    ],
  },
  chainAttributes: {
    type: 'chain-attributes',
    title: 'Chain Attributes',
    description: 'Define chain-wide billing and operating attributes.',
    fields: [
      { key: 'attributeType', label: 'Attribute Type' },
      { key: 'value', label: 'Value' },
      { key: 'appliesTo', label: 'Applies To' },
      { key: 'mandatory', label: 'Mandatory', type: 'checkbox' },
    ],
  },
  receiptPrint: {
    type: 'receipt-print',
    title: 'Receipts Print',
    description: 'Manage receipt print templates and default receipt behavior.',
    fields: [
      { key: 'template', label: 'Template', type: 'select', options: [{ label: 'Thermal 80mm', value: 'thermal-80' }, { label: 'Thermal 58mm', value: 'thermal-58' }, { label: 'A4 Invoice', value: 'a4' }] },
      { key: 'showLogo', label: 'Show Logo', type: 'checkbox', defaultValue: true },
      { key: 'footerText', label: 'Footer Text', type: 'textarea' },
      { key: 'autoPrint', label: 'Auto Print', type: 'checkbox' },
    ],
  },
  customizeReceiptPrint: {
    type: 'customize-receipt-print',
    title: 'Customize Receipt Print',
    description: 'Customize receipt header, footer, copies, and print sections.',
    fields: [
      { key: 'headerText', label: 'Header Text', type: 'textarea' },
      { key: 'footerText', label: 'Footer Text', type: 'textarea' },
      { key: 'copies', label: 'Copies', type: 'number', defaultValue: '1' },
      { key: 'showTaxBreakup', label: 'Show Tax Breakup', type: 'checkbox', defaultValue: true },
    ],
  },
  kotPrinters: {
    type: 'kot-printers',
    title: 'KOT Printers',
    description: 'Register kitchen order ticket printers and routing settings.',
    storeScoped: true,
    fields: [
      { key: 'printerIp', label: 'Printer IP' },
      { key: 'port', label: 'Port', type: 'number', defaultValue: '9100' },
      { key: 'department', label: 'Department' },
      { key: 'autoCut', label: 'Auto Cut', type: 'checkbox', defaultValue: true },
    ],
  },
  kotPrinterConfig: {
    type: 'kot-printer-config',
    title: 'KOT Printer Config',
    description: 'Configure KOT print routing by store, department, and printer.',
    storeScoped: true,
    fields: [
      { key: 'printerName', label: 'Printer Name' },
      { key: 'routeGroup', label: 'Route Group' },
      { key: 'printCopies', label: 'Print Copies', type: 'number', defaultValue: '1' },
      { key: 'enabledForOnline', label: 'Online Orders', type: 'checkbox', defaultValue: true },
    ],
  },
  billingRemarks: {
    type: 'billing-remarks',
    title: 'Remarks Settings',
    description: 'Create reusable billing, return, and order remarks.',
    fields: [
      { key: 'remarkType', label: 'Remark Type', type: 'select', options: [{ label: 'Billing', value: 'billing' }, { label: 'Return', value: 'return' }, { label: 'Order', value: 'order' }] },
      { key: 'remarkText', label: 'Remark Text', type: 'textarea' },
      { key: 'requiresApproval', label: 'Requires Approval', type: 'checkbox' },
    ],
  },
  systemAttributes: {
    type: 'system-attributes',
    title: 'System Attributes',
    description: 'Maintain shared system attributes used across modules.',
    fields: [
      { key: 'attributeGroup', label: 'Attribute Group' },
      { key: 'dataType', label: 'Data Type', type: 'select', options: [{ label: 'Text', value: 'text' }, { label: 'Number', value: 'number' }, { label: 'Boolean', value: 'boolean' }, { label: 'Date', value: 'date' }] },
      { key: 'defaultValue', label: 'Default Value' },
      { key: 'required', label: 'Required', type: 'checkbox' },
    ],
  },
  customAttributes: {
    type: 'custom-attributes',
    title: 'Custom Attributes',
    description: 'Configure custom attributes for records and workflows.',
    fields: [
      { key: 'module', label: 'Module' },
      { key: 'fieldType', label: 'Field Type', type: 'select', options: [{ label: 'Text', value: 'text' }, { label: 'Number', value: 'number' }, { label: 'Dropdown', value: 'dropdown' }, { label: 'Date', value: 'date' }] },
      { key: 'options', label: 'Dropdown Options', type: 'textarea' },
      { key: 'required', label: 'Required', type: 'checkbox' },
    ],
  },
  roomsTables: {
    type: 'rooms-tables',
    title: 'Rooms Tables',
    description: 'Manage rooms, table numbers, and seating capacity.',
    storeScoped: true,
    fields: [
      { key: 'roomName', label: 'Room Name' },
      { key: 'tableNumber', label: 'Table Number' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'serviceArea', label: 'Service Area' },
    ],
  },
  salesTargets: {
    type: 'sales-targets',
    title: 'Sales Targets',
    description: 'Configure sales targets by store, period, and role.',
    storeScoped: true,
    fields: [
      { key: 'period', label: 'Period', type: 'select', options: [{ label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' }] },
      { key: 'targetAmount', label: 'Target Amount', type: 'number' },
      { key: 'targetBills', label: 'Target Bills', type: 'number' },
      { key: 'ownerRole', label: 'Owner Role' },
    ],
  },
  storePaymentModes: {
    type: 'store-payment-modes',
    title: 'Store Payment Modes',
    description: 'Map allowed payment modes to each store.',
    storeScoped: true,
    fields: [
      { key: 'paymentMode', label: 'Payment Mode', type: 'select', options: paymentModeOptions },
      { key: 'provider', label: 'Provider' },
      { key: 'settlementAccount', label: 'Settlement Account' },
      { key: 'allowRefund', label: 'Allow Refund', type: 'checkbox', defaultValue: true },
    ],
  },
  chainPaymentSettings: {
    type: 'chain-payment-settings',
    title: 'Chain Payment Settings',
    description: 'Configure chain-wide payment modes and settlement rules.',
    fields: [
      { key: 'paymentMode', label: 'Payment Mode', type: 'select', options: paymentModeOptions },
      { key: 'provider', label: 'Provider' },
      { key: 'autoSettle', label: 'Auto Settle', type: 'checkbox' },
      { key: 'enabledOnline', label: 'Enabled Online', type: 'checkbox', defaultValue: true },
    ],
  },
  storePaymentSettings: {
    type: 'store-payment-settings',
    title: 'Store Payment Settings',
    description: 'Configure store-specific payment credentials and toggles.',
    storeScoped: true,
    fields: [
      { key: 'paymentMode', label: 'Payment Mode', type: 'select', options: paymentModeOptions },
      { key: 'merchantId', label: 'Merchant ID' },
      { key: 'terminalId', label: 'Terminal ID' },
      { key: 'enabled', label: 'Enabled', type: 'checkbox', defaultValue: true },
    ],
  },
  refundConfiguration: {
    type: 'refund-configuration',
    title: 'Refund Configuration',
    description: 'Configure refund modes, approval rules, and limits.',
    storeScoped: true,
    fields: [
      { key: 'refundMode', label: 'Refund Mode', type: 'select', options: paymentModeOptions },
      { key: 'maxRefundAmount', label: 'Max Refund Amount', type: 'number' },
      { key: 'approvalRequired', label: 'Approval Required', type: 'checkbox', defaultValue: true },
      { key: 'sameDayOnly', label: 'Same Day Only', type: 'checkbox' },
    ],
  },
  redemptionConfiguration: {
    type: 'redemption-configuration',
    title: 'Redemption Configuration',
    description: 'Configure credit note and voucher redemption behavior.',
    storeScoped: true,
    fields: [
      { key: 'redemptionType', label: 'Redemption Type' },
      { key: 'maxUses', label: 'Max Uses', type: 'number' },
      { key: 'requiresOtp', label: 'Requires OTP', type: 'checkbox' },
      { key: 'allowPartial', label: 'Allow Partial Redemption', type: 'checkbox', defaultValue: true },
    ],
  },
  measurementUnit: {
    type: 'measurement-unit',
    title: 'Measurement Unit',
    description: 'Maintain inventory units of measurement.',
    fields: [
      { key: 'symbol', label: 'Symbol' },
      { key: 'unitType', label: 'Unit Type', type: 'select', options: [{ label: 'Count', value: 'count' }, { label: 'Weight', value: 'weight' }, { label: 'Volume', value: 'volume' }, { label: 'Length', value: 'length' }] },
      { key: 'decimalPlaces', label: 'Decimal Places', type: 'number', defaultValue: '0' },
      { key: 'baseUnit', label: 'Base Unit' },
    ],
  },
  inventorySystemAttributes: {
    type: 'inventory-system-attributes',
    title: 'Inventory System Attributes',
    description: 'Configure system inventory attributes and defaults.',
    fields: [
      { key: 'attributeGroup', label: 'Attribute Group' },
      { key: 'trackingMode', label: 'Tracking Mode' },
      { key: 'defaultEnabled', label: 'Default Enabled', type: 'checkbox' },
      { key: 'visibleInReports', label: 'Visible In Reports', type: 'checkbox', defaultValue: true },
    ],
  },
  inventoryCustomAttributes: {
    type: 'inventory-custom-attributes',
    title: 'Inventory Custom Attributes',
    description: 'Create custom inventory fields for stock operations.',
    fields: [
      { key: 'appliesTo', label: 'Applies To' },
      { key: 'fieldType', label: 'Field Type' },
      { key: 'options', label: 'Options', type: 'textarea' },
      { key: 'required', label: 'Required', type: 'checkbox' },
    ],
  },
  applicationDeviceSettings: {
    type: 'application-device-settings',
    title: 'Application Device Settings',
    description: 'Configure device-level application behavior.',
    storeScoped: true,
    fields: [
      { key: 'deviceType', label: 'Device Type' },
      { key: 'syncInterval', label: 'Sync Interval Minutes', type: 'number' },
      { key: 'allowOffline', label: 'Allow Offline', type: 'checkbox', defaultValue: true },
      { key: 'printerRequired', label: 'Printer Required', type: 'checkbox' },
    ],
  },
  storeDeviceMap: {
    type: 'store-device-map',
    title: 'Store Device Map',
    description: 'Map devices to stores and counters.',
    storeScoped: true,
    fields: [
      { key: 'deviceId', label: 'Device ID' },
      { key: 'deviceName', label: 'Device Name' },
      { key: 'counterName', label: 'Counter Name' },
      { key: 'isPrimary', label: 'Primary Device', type: 'checkbox' },
    ],
  },
  deviceDataSync: {
    type: 'device-data-sync',
    title: 'Device Data Sync',
    description: 'Configure sync jobs and data sync preferences.',
    storeScoped: true,
    fields: [
      { key: 'syncType', label: 'Sync Type' },
      { key: 'frequency', label: 'Frequency' },
      { key: 'lastRunMode', label: 'Last Run Mode' },
      { key: 'enabled', label: 'Enabled', type: 'checkbox', defaultValue: true },
    ],
  },
  deviceSyncLogs: {
    type: 'device-sync-logs',
    title: 'Device Sync Logs',
    description: 'Record device sync log markers and notes.',
    storeScoped: true,
    fields: [
      { key: 'deviceId', label: 'Device ID' },
      { key: 'syncStatus', label: 'Sync Status', type: 'select', options: [{ label: 'Success', value: 'success' }, { label: 'Failed', value: 'failed' }, { label: 'Pending', value: 'pending' }] },
      { key: 'recordsSynced', label: 'Records Synced', type: 'number' },
      { key: 'errorMessage', label: 'Error Message', type: 'textarea' },
    ],
  },
};

export function getSettingPageConfig(key) {
  const config = settingsPageConfigs[key];
  return {
    ...config,
    breadcrumbs: [
      { label: 'Home', href: '/home' },
      { label: 'Settings', href: '/settings' },
      { label: config.title },
    ],
  };
}
