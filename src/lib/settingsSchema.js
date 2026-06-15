import { query } from '@/lib/db';
import { ensureStoresSchema } from '@/lib/storesSchema';

const CREATE_SETTINGS_RECORDS_SQL = `
  CREATE TABLE IF NOT EXISTS settings_records (
    id BIGSERIAL PRIMARY KEY,
    setting_type VARCHAR(120) NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(120),
    description TEXT,
    store_id BIGINT REFERENCES stores(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (setting_type, code, store_id)
  );
`;

const MIGRATE_SETTINGS_RECORDS_SQL = `
  CREATE INDEX IF NOT EXISTS idx_settings_records_type ON settings_records(setting_type);
  CREATE INDEX IF NOT EXISTS idx_settings_records_store ON settings_records(store_id);
  CREATE INDEX IF NOT EXISTS idx_settings_records_active ON settings_records(is_active);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_records_type_code_store_key
    ON settings_records(setting_type, code, COALESCE(store_id, 0))
    WHERE code IS NOT NULL;
`;

const DEFAULT_SETTINGS = [
  {
    type: 'business-info',
    name: 'Default Business Info',
    code: 'default',
    description: 'Primary legal and contact details for the chain.',
    config: { legalName: 'Buyzaar Sync', gstin: '', phone: '9999999999', email: 'admin@example.com', address: '' },
  },
  {
    type: 'app-settings',
    name: 'Default App Settings',
    code: 'default',
    description: 'Default POS application preferences.',
    config: { timezone: 'Asia/Kolkata', currency: 'INR', dateFormat: 'DD/MM/YY', allowOfflineBilling: true },
  },
  {
    type: 'receipt-print',
    name: 'Default Receipt Print',
    code: 'default',
    description: 'Default receipt print template.',
    config: { template: 'thermal-80', showLogo: true, footerText: 'Thank you. Visit again.', autoPrint: false },
  },
  {
    type: 'customize-receipt-print',
    name: 'Default POS Receipt',
    code: 'default',
    description: 'Default receipt template used by POS print.',
    config: {
      businessName: 'Buyzaar Sync',
      subtitle: 'GST Invoice / POS Receipt',
      headerText: '',
      footerText: 'Thank you. Visit again.',
      template: 'thermal-80',
      copies: 1,
      showTaxBreakup: true,
      showDiscount: true,
      showQr: true,
      showCustomerMobile: true,
      showSku: true,
    },
  },
  {
    type: 'chain-payment-settings',
    name: 'Cash Payments',
    code: 'cash',
    description: 'Default chain-wide cash payment mode.',
    config: { paymentMode: 'cash', provider: 'Cash Counter', autoSettle: true, enabledOnline: false },
  },
  {
    type: 'store-payment-modes',
    name: 'Cash Payment Mode',
    code: 'cash',
    description: 'Default store cash payment mode.',
    config: { paymentMode: 'cash', provider: 'Cash Counter', settlementAccount: '', allowRefund: true },
  },
  {
    type: 'store-payment-settings',
    name: 'Default Store Payment Settings',
    code: 'default',
    description: 'Default store payment credentials placeholder.',
    config: { paymentMode: 'cash', merchantId: '', terminalId: '', enabled: true },
  },
  {
    type: 'billing-remarks',
    name: 'Default Billing Remark',
    code: 'default-billing',
    description: 'Reusable default billing remark.',
    config: { remarkType: 'billing', remarkText: 'Customer request', requiresApproval: false },
  },
  {
    type: 'system-attributes',
    name: 'Default System Attribute',
    code: 'default',
    description: 'Default shared system attribute.',
    config: { attributeGroup: 'General', dataType: 'text', defaultValue: '', required: false },
  },
  {
    type: 'custom-attributes',
    name: 'Default Custom Attribute',
    code: 'default',
    description: 'Default custom attribute template.',
    config: { module: 'Products', fieldType: 'text', options: '', required: false },
  },
  {
    type: 'chain-attributes',
    name: 'Default Chain Attribute',
    code: 'default',
    description: 'Default chain-wide attribute.',
    config: { attributeType: 'General', value: '', appliesTo: 'All Stores', mandatory: false },
  },
  {
    type: 'rooms-tables',
    name: 'Default Dining Area',
    code: 'default',
    description: 'Default dine-in room and table setup.',
    config: { roomName: 'Main Hall', tableNumber: 'T1', capacity: '4', serviceArea: 'Dine In' },
  },
  {
    type: 'sales-targets',
    name: 'Default Monthly Target',
    code: 'monthly-default',
    description: 'Default monthly sales target template.',
    config: { period: 'monthly', targetAmount: '0', targetBills: '0', ownerRole: 'Store Manager' },
  },
  {
    type: 'refund-configuration',
    name: 'Default Refund Configuration',
    code: 'default',
    description: 'Default refund rules.',
    config: { refundMode: 'cash', maxRefundAmount: '0', approvalRequired: true, sameDayOnly: false },
  },
  {
    type: 'redemption-configuration',
    name: 'Default Redemption Configuration',
    code: 'default',
    description: 'Default credit note redemption rules.',
    config: { redemptionType: 'Credit Note', maxUses: '1', requiresOtp: false, allowPartial: true },
  },
  {
    type: 'measurement-unit',
    name: 'Piece',
    code: 'pcs',
    description: 'Default count unit.',
    config: { symbol: 'pcs', unitType: 'count', decimalPlaces: '0', baseUnit: 'pcs' },
  },
  {
    type: 'inventory-system-attributes',
    name: 'Default Inventory Attribute',
    code: 'default',
    description: 'Default inventory tracking attribute.',
    config: { attributeGroup: 'Stock', trackingMode: 'Standard', defaultEnabled: true, visibleInReports: true },
  },
  {
    type: 'inventory-custom-attributes',
    name: 'Default Inventory Custom Attribute',
    code: 'default',
    description: 'Default custom stock field.',
    config: { appliesTo: 'Products', fieldType: 'text', options: '', required: false },
  },
  {
    type: 'kot-printers',
    name: 'Default KOT Printer',
    code: 'default',
    description: 'Default kitchen printer configuration.',
    config: { printerIp: '127.0.0.1', port: '9100', department: 'Kitchen', autoCut: true },
  },
  {
    type: 'kot-printer-config',
    name: 'Default KOT Route',
    code: 'default',
    description: 'Default KOT print routing.',
    config: { printerName: 'Kitchen Printer', routeGroup: 'Kitchen', printCopies: '1', enabledForOnline: true },
  },
  {
    type: 'application-device-settings',
    name: 'Default Device Settings',
    code: 'default',
    description: 'Default application device behavior.',
    config: { deviceType: 'POS', syncInterval: '15', allowOffline: true, printerRequired: false },
  },
  {
    type: 'store-device-map',
    name: 'Default Store Device',
    code: 'default',
    description: 'Default store device mapping template.',
    config: { deviceId: 'POS-DEFAULT', deviceName: 'Default POS', counterName: 'Main Counter', isPrimary: true },
  },
  {
    type: 'device-data-sync',
    name: 'Default Data Sync',
    code: 'default',
    description: 'Default device sync schedule.',
    config: { syncType: 'Full Sync', frequency: '15 minutes', lastRunMode: 'Automatic', enabled: true },
  },
  {
    type: 'device-sync-logs',
    name: 'Initial Sync Log',
    code: 'initial',
    description: 'Initial device sync log marker.',
    config: { deviceId: 'POS-DEFAULT', syncStatus: 'pending', recordsSynced: '0', errorMessage: '' },
  },
];

async function seedDefaultSettings() {
  for (const item of DEFAULT_SETTINGS) {
    await query(
      `INSERT INTO settings_records (
         setting_type, name, code, description, store_id, is_active, config, created_at, updated_at
       )
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::text, NULL, TRUE, $5::jsonb, NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1
         FROM settings_records
         WHERE setting_type = $1::varchar
           AND code = $3::varchar
           AND store_id IS NULL
       )`,
      [item.type, item.name, item.code, item.description, JSON.stringify(item.config)]
    );
  }
}

const globalForSettings = globalThis;

export async function ensureSettingsSchema() {
  if (!globalForSettings._settingsSchemaReadyPromise) {
    globalForSettings._settingsSchemaReadyPromise = (async () => {
      await ensureStoresSchema();
      await query(CREATE_SETTINGS_RECORDS_SQL);
      await query(MIGRATE_SETTINGS_RECORDS_SQL);
      await seedDefaultSettings();
    })().catch((err) => {
      globalForSettings._settingsSchemaReadyPromise = null;
      throw err;
    });
  }

  await globalForSettings._settingsSchemaReadyPromise;
}
