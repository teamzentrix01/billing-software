const ROLE_HOME_PATHS = {
  super_admin: '/home/master-dashboard',
  admin: '/home',
  manager: '/home',
  user: '/sales/pos',
};

const SUPER_ADMIN_PERMISSION = '*';

const SECTION_PERMISSION_RULES = {
  Home: ['ACCESS_DASHBOARD'],
  Sales: ['CREATE_POS_BILL', 'MANAGE_ORDERS', 'VIEW_ORDERS'],
  Catalog: ['MANAGE_CATALOG', 'VIEW_CATALOG'],
  Inventory: ['MANAGE_INVENTORY', 'VIEW_INVENTORY'],
  Purchase: ['MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS'],
  'Sales Order': ['MANAGE_ORDERS', 'VIEW_ORDERS'],
  Admin: ['*'],
  Employee: ['MANAGE_ROLES', 'MANAGE_USERS', 'VIEW_USERS'],
  Customer: ['MANAGE_CUSTOMERS', 'VIEW_CUSTOMERS'],
  Settings: ['MANAGE_STORES', 'VIEW_STORES', 'MANAGE_PAYMENTS', 'MANAGE_TAXES'],
  Reports: ['VIEW_FINANCIAL_REPORTS', 'VIEW_STORE_REPORTS'],
};

const ITEM_PERMISSION_RULES = {
  '/': ['ACCESS_DASHBOARD'],
  '/home': ['ACCESS_DASHBOARD'],
  '/home/master-dashboard': ['ACCESS_DASHBOARD'],
  '/sales': ['CREATE_POS_BILL', 'MANAGE_ORDERS', 'VIEW_ORDERS'],
  '/sales/pos': ['CREATE_POS_BILL'],
  '/sales/store-cash': ['CREATE_POS_BILL', 'OPEN_CLOSE_SESSION', 'MANAGE_POS', 'MANAGE_BILLING', 'VIEW_STORE_REPORTS'],
  '/sales/returns': ['CREATE_POS_BILL', 'MANAGE_ORDERS', 'VIEW_ORDERS'],
  '/catalog': ['MANAGE_CATALOG', 'VIEW_CATALOG'],
  '/inventory': ['MANAGE_INVENTORY', 'VIEW_INVENTORY'],
  '/purchase': ['MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS'],
  '/sales-order': ['MANAGE_ORDERS', 'VIEW_ORDERS'],
  '/admin/assistant': ['*'],
  '/customer': ['MANAGE_CUSTOMERS', 'VIEW_CUSTOMERS'],
  '/reports': ['VIEW_FINANCIAL_REPORTS', 'VIEW_STORE_REPORTS'],
  '/employee': ['MANAGE_ROLES', 'MANAGE_USERS', 'VIEW_USERS'],
  '/employee/staffdepartments': ['MANAGE_USERS', 'VIEW_USERS'],
  '/employee/staff': ['MANAGE_USERS', 'VIEW_USERS'],
  '/employee/user-counter-session': ['OPEN_CLOSE_SESSION'],
  '/settings': ['MANAGE_STORES', 'VIEW_STORES', 'MANAGE_BILLING', 'MANAGE_PAYMENTS', 'MANAGE_TAXES'],
  '/settings/stores': ['MANAGE_STORES', 'VIEW_STORES'],
  '/settings/warehouses': ['MANAGE_STORES', 'VIEW_STORES'],
  '/settings/regions': ['MANAGE_STORES', 'VIEW_STORES'],
  '/settings/device-config/store-device-map': ['MANAGE_STORES'],
  '/settings/device-config/application-device-settings': ['MANAGE_STORES'],
  '/settings/device-config/device-sync-logs': ['MANAGE_STORES'],
  '/settings/device-config/device-data-sync': ['MANAGE_STORES'],
  '/settings/billing/customize-receipt-print': ['MANAGE_BILLING'],
  '/settings/billing/remarks': ['MANAGE_BILLING'],
  '/settings/billing/kot-printer-config': ['MANAGE_BILLING'],
  '/settings/billing/chain-attributes': ['MANAGE_BILLING'],
  '/settings/inventory/system-attributes': ['MANAGE_STORES', 'MANAGE_INVENTORY'],
  '/settings/inventory/custom-attributes': ['MANAGE_STORES', 'MANAGE_INVENTORY'],
  '/settings/inventory/measurement-unit': ['MANAGE_STORES', 'MANAGE_INVENTORY'],
  '/settings/payment/chain-payment-settings': ['MANAGE_PAYMENTS'],
  '/settings/payment/store-payment-settings': ['MANAGE_PAYMENTS'],
  '/settings/credit-note/redemption-configuration': ['MANAGE_BILLING'],
  '/settings/credit-note/refund-configuration': ['MANAGE_BILLING'],
  '/settings/business-info': ['MANAGE_BILLING'],
  '/settings/receipts-print': ['MANAGE_BILLING'],
  '/settings/kot-printers': ['MANAGE_BILLING'],
  '/settings/system-attributes': ['MANAGE_STORES', 'MANAGE_INVENTORY'],
  '/settings/custom-attributes': ['MANAGE_STORES', 'MANAGE_INVENTORY'],
  '/settings/rooms-tables': ['MANAGE_STORES'],
  '/settings/sales-targets': ['MANAGE_BILLING'],
  '/settings/app-settings': ['MANAGE_BILLING'],
  '/settings/store-payment-modes': ['MANAGE_PAYMENTS'],
};

const ROUTE_PERMISSION_RULES = [
  { prefix: '/login', permissions: [] },
  { prefix: '/home/master-dashboard', permissions: ['ACCESS_DASHBOARD'] },
  { prefix: '/home', permissions: ['ACCESS_DASHBOARD'] },
  { prefix: '/sales/pos', permissions: ['CREATE_POS_BILL'] },
  { prefix: '/sales/store-cash', permissions: ['CREATE_POS_BILL', 'OPEN_CLOSE_SESSION', 'MANAGE_POS', 'MANAGE_BILLING', 'VIEW_STORE_REPORTS'] },
  { prefix: '/sales/returns', permissions: ['CREATE_POS_BILL', 'MANAGE_ORDERS', 'VIEW_ORDERS'] },
  { prefix: '/sales-order', permissions: ['MANAGE_ORDERS', 'VIEW_ORDERS'] },
  { prefix: '/admin', permissions: ['*'] },
  { prefix: '/sales', permissions: ['CREATE_POS_BILL', 'MANAGE_ORDERS', 'VIEW_ORDERS'] },
  { prefix: '/catalog', permissions: ['MANAGE_CATALOG', 'VIEW_CATALOG'] },
  { prefix: '/inventory', permissions: ['MANAGE_INVENTORY', 'VIEW_INVENTORY'] },
  { prefix: '/purchase', permissions: ['MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS'] },
  { prefix: '/employee/staffdepartments', permissions: ['MANAGE_USERS', 'VIEW_USERS'] },
  { prefix: '/employee/staff', permissions: ['MANAGE_USERS', 'VIEW_USERS'] },
  { prefix: '/employee/user-counter-session', permissions: ['OPEN_CLOSE_SESSION'] },
  { prefix: '/employee', permissions: ['MANAGE_ROLES', 'MANAGE_USERS', 'VIEW_USERS'] },
  { prefix: '/settings/stores', permissions: ['MANAGE_STORES', 'VIEW_STORES'] },
  { prefix: '/settings/warehouses', permissions: ['MANAGE_STORES', 'VIEW_STORES'] },
  { prefix: '/settings/regions', permissions: ['MANAGE_STORES', 'VIEW_STORES'] },
  { prefix: '/settings/payment/chain-payment-settings', permissions: ['MANAGE_PAYMENTS'] },
  { prefix: '/settings/billing/chain-attributes', permissions: ['MANAGE_BILLING'] },
  { prefix: '/settings/business-info', permissions: ['MANAGE_BILLING'] },
  { prefix: '/settings/app-settings', permissions: ['MANAGE_BILLING'] },
  { prefix: '/settings/store-payment-modes', permissions: ['MANAGE_PAYMENTS'] },
  { prefix: '/settings', permissions: ['MANAGE_STORES', 'VIEW_STORES', 'MANAGE_PAYMENTS', 'MANAGE_TAXES'] },
  { prefix: '/customer', permissions: ['MANAGE_CUSTOMERS', 'VIEW_CUSTOMERS'] },
  { prefix: '/reports', permissions: ['VIEW_FINANCIAL_REPORTS', 'VIEW_STORE_REPORTS'] },
];

function normalizeRole(role) {
  return role || 'guest';
}

function getPermissionList(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions)) return user.permissions.filter(Boolean);
  return [];
}

function isSuperAdmin(user) {
  if (!user) return false;
  
  // Check by role first
  if (user.role === 'super_admin') return true;
  
  // Check by permission array
  const permissions = getPermissionList(user);
  return permissions.includes(SUPER_ADMIN_PERMISSION);
}

function hasAnyPermission(user, permissions = []) {
  if (!user) return false;
  
  // Super admin check - should come first
  if (isSuperAdmin(user)) return true;
  
  // If no permissions required, grant access
  if (permissions.length === 0) return true;
  
  // Check user permissions
  const userPermissions = getPermissionList(user);
  return permissions.some((permission) => userPermissions.includes(permission));
}

function permissionAllowed(user, permissions = []) {
  if (!permissions.length) return true;
  if (!user) return false;
  
  // Check if super admin by role
  if (user.role === 'super_admin') return true;
  
  // Check if super admin by permissions
  const userPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (userPermissions.includes('*')) return true;
  
  // Check specific permissions
  return permissions.some((permission) => userPermissions.includes(permission));
}

function accessEntryAllowed(user, roles = [], permissions = []) {
  if (permissions.length) return permissionAllowed(user, permissions);
  return roleAllowed(user?.role, roles);
}

function pathMatches(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getMatchingRouteRule(pathname) {
  const sortedRules = [...ROUTE_PERMISSION_RULES].sort((a, b) => b.prefix.length - a.prefix.length);
  return sortedRules.find((entry) => pathMatches(pathname, entry.prefix));
}

function getItemPermissions(item, sectionLabel) {
  return ITEM_PERMISSION_RULES[item?.href] || SECTION_PERMISSION_RULES[sectionLabel] || [];
}

export function getDefaultRouteForUser(user) {
  // Return based on role
  const rolePath = ROLE_HOME_PATHS[user?.role];
  if (rolePath) return rolePath;
  return '/home';
}

export function canAccessPath(user, pathname) {
  if (isSuperAdmin(user)) return true;

  const rule = getMatchingRouteRule(pathname);
  if (!rule) return false;
  if (rule.permissions.length === 0) return true;

  return hasAnyPermission(user, rule.permissions);
}

export function filterMenuItemsForUser(menuItems, user) {
  // Super admin sees everything
  if (isSuperAdmin(user)) {
    return menuItems;
  }

  // If no user, return empty
  if (!user) {
    return [];
  }

  return menuItems
    .map((item) => {
      if (!item.subSidebar?.groups) {
        return hasAnyPermission(user, getItemPermissions(item, item.label)) ? item : null;
      }

      // For sensitive sections like Settings and Employee, require a
      // section-level permission before exposing the section at all.
      if (['Settings', 'Employee'].includes(item.label)) {
        const sectionPerms = SECTION_PERMISSION_RULES[item.label] || [];
        if (!hasAnyPermission(user, sectionPerms)) {
          return null;
        }
      }

      const groups = item.subSidebar.groups
        .map((group) => ({
          ...group,
          items: group.items.filter((subItem) =>
            hasAnyPermission(user, getItemPermissions(subItem, item.label))
          ),
        }))
        .filter((group) => group.items.length > 0);

      if (groups.length === 0) return null;

      return {
        ...item,
        subSidebar: {
          ...item.subSidebar,
          groups,
        },
      };
    })
    .filter(Boolean);
}

export function getFirstAccessibleHref(menuItems, user) {
  const filtered = filterMenuItemsForUser(menuItems, user);
  const first = filtered[0];
  const firstSubItem = first?.subSidebar?.groups?.[0]?.items?.[0];
  return firstSubItem?.href || first?.href || null;
}

export function getPageTitleForMenu(menuItems, pathname) {
  for (const item of menuItems) {
    if (pathname === item.href || pathname.startsWith(item.href + '/')) {
      if (item.subSidebar?.groups) {
        for (const group of item.subSidebar.groups) {
          const match = group.items.find(
            (subItem) => pathname === subItem.href || pathname.startsWith(subItem.href + '/')
          );
          if (match?.label) return match.label;
        }
      }
      return item.label;
    }
  }

  return 'Home';
}
