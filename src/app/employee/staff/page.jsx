'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';
import { validatePhoneNumber } from '@/lib/phoneValidator';

const PAGE_SIZES = [10, 25, 50, 100];

const INITIAL_FORM = {
  firstName: '',
  lastName: '',
  username: '',
  gender: 'Male',
  password: '',
  confirmPassword: '',
  mobileNumber: '',
  emailAddress: '',
  roleName: '',
  permissions: [],
  regionStore: [],
  warehouse: [],
  departmentId: '',
  customerName: '',
  userType: 'Regular',
  dateOfBirth: '',
  dateOfJoining: '',
  dateOfLeaving: '',
  employeeCode: '',
  createCustomerSameDetails: false,
  employmentType: 'Payroll',
  address: '',
  employmentStatus: 'Active',
  contractorName: '',
  discountLimitType: 'Percentage',
  discountLimitValue: '',
  maximumDiscountAmount: '',
};

const columns = [
  { key: 'sno', label: 'S.No' },
  { key: 'username', label: 'Username' },
  { key: 'name', label: 'Name' },
  { key: 'employeeCode', label: 'Employee Code' },
  { key: 'role', label: 'Role' },
  { key: 'department', label: 'Department' },
  { key: 'employeeType', label: 'Employee Type' },
  { key: 'contractorName', label: 'Contractor Name' },
  { key: 'mobileNumber', label: 'Mobile Number' },
  { key: 'emailAddress', label: 'Email Address' },
  { key: 'employmentStatus', label: 'Employment Status' },
  { key: 'actions', label: 'Actions' },
];

function mapEmployeeRow(row) {
  return {
    id: row.id,
    username: row.username || '',
    name: row.name || [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
    employeeCode: row.employeeCode || '',
    role: row.role || '',
    department: row.department || '',
    employeeType: row.employeeType || '',
    contractorName: row.contractorName || '',
    mobileNumber: row.mobileNumber || '',
    emailAddress: row.emailAddress || '',
    employmentStatus: row.employmentStatus || 'Active',
    firstName: row.firstName || '',
    lastName: row.lastName || '',
    gender: row.gender || '',
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    regionStore: row.regionStore || '',
    warehouse: row.warehouse || '',
    userType: row.userType || '',
    dateOfBirth: row.dateOfBirth || null,
    dateOfJoining: row.dateOfJoining || null,
    dateOfLeaving: row.dateOfLeaving || null,
    customerName: row.customerName || '',
    address: row.address || '',
    discountLimitType: row.discountLimitType || '',
    discountLimitValue: row.discountLimitValue ?? null,
    maximumDiscountAmount: row.maximumDiscountAmount ?? null,
    createCustomerSameDetails: Boolean(row.createCustomerSameDetails),
    createdAt: row.createdAt || null,
  };
}

async function fetchEmployees() {
  try {
    const res = await fetch('/api/employee/staff');
    if (!res.ok) throw new Error('Failed to fetch employees');
    return res.json();
  } catch (err) {
    console.error('Fetch employees error:', err);
    return [];
  }
}

async function fetchRoles() {
  try {
    const res = await fetch('/api/employee/roles');
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchPermissions() {
  try {
    const res = await fetch('/api/employee/permissions');
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchDepartments() {
  try {
    const res = await fetch('/api/employee/departments');
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function extractRecords(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data?.stores)) return data.data.stores;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.stores)) return data.stores;
  if (Array.isArray(data?.records)) return data.records;
  if (data?.success && Array.isArray(data.data)) return data.data;
  return [];
}

async function fetchStores() {
  try {
    const res = await fetch('/api/stores');
    
    if (!res.ok) {
      console.warn('Stores API returned status:', res.status);
      return [];
    }
    
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      console.warn('Invalid content type:', contentType);
      return [];
    }
    
    return extractRecords(await res.json());
  } catch (err) {
    console.error('Failed to fetch stores:', err.message);
    return [];
  }
}

async function fetchWarehouses() {
  try {
    const res = await fetch('/api/warehouses');
    if (!res.ok) {
      console.warn('Warehouses API returned status:', res.status);
      return [];
    }

    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      console.warn('Invalid content type:', contentType);
      return [];
    }

    return extractRecords(await res.json());
  } catch (err) {
    console.error('Failed to fetch warehouses:', err.message);
    return [];
  }
}

async function createEmployee(payload) {
  const res = await fetch('/api/employee/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create employee');
  return data;
}

async function updateEmployee(id, payload) {
  const res = await fetch(`/api/employee/staff/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update employee');
  return data;
}

async function deleteEmployee(id) {
  const res = await fetch(`/api/employee/staff/${id}`, {
    method: 'DELETE',
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete employee');
  return data;
}

async function fetchPasswordChangeRequests() {
  const res = await fetch('/api/auth/password-change-requests?status=pending');
  if (res.status === 401 || res.status === 403) return [];

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'Failed to fetch password requests');
  }

  return Array.isArray(data.data?.requests) ? data.data.requests : [];
}

async function updatePasswordChangeRequest(id, action) {
  const res = await fetch(`/api/auth/password-change-requests/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Failed to ${action} request`);
  }

  return data;
}

function randomPassword() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `Emp${Array.from(bytes, (byte) => (byte % 36).toString(36)).join('')}`;
}

function normalizeMobileInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function parseMultiValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const str = String(value || '').trim();
  if (!str) return [];
  return str.split(',').map((item) => item.trim()).filter(Boolean);
}

function MultiSelect({ label, options, value, onChange, placeholder = 'Select', required = false, showSelectAll = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectAllRef = useRef(null);

  const selectableOptions = useMemo(
    () => options.filter((option) => option.value),
    [options]
  );

  const allValues = useMemo(
    () => selectableOptions.map((option) => option.value),
    [selectableOptions]
  );

  const allSelected = allValues.length > 0 && allValues.every((optionValue) => value.includes(optionValue));
  const someSelected = allValues.some((optionValue) => value.includes(optionValue));

  useEffect(() => {
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected, open]);

  const labels = useMemo(() => {
    const selected = selectableOptions.filter((option) => value.includes(option.value));
    if (selected.length === 0) return placeholder;
    if (selected.length <= 2) return selected.map((option) => option.label).join(', ');
    return `${selected.slice(0, 2).map((option) => option.label).join(', ')} +${selected.length - 2}`;
  }, [selectableOptions, placeholder, value]);

  return (
    <div ref={ref}>
      <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">{label}{required ? <span className="text-red-500"> *</span> : null}</label>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 pr-8 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all bg-white flex items-center justify-between gap-3"
      >
        <span className="truncate text-left">{labels}</span>
        <i className={`ti ti-chevron-down text-[12px] text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="relative z-30">
          <div className="absolute mt-2 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-auto">
            {selectableOptions.length === 0 ? (
              <div className="px-3 py-2 text-[12.5px] text-gray-400">No options available</div>
            ) : (
              <>
                {showSelectAll && (
                  <label className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer hover:bg-gray-50 border-b border-gray-100 font-medium">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => onChange(allSelected ? [] : allValues)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="flex-1 text-gray-700">Select All</span>
                  </label>
                )}
                {selectableOptions.map((option) => {
                  const checked = value.includes(option.value);
                  return (
                    <label key={option.value} className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          onChange(
                            event.target.checked
                              ? [...value, option.value]
                              : value.filter((selected) => selected !== option.value)
                          );
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex-1 text-gray-700">{option.label}</span>
                    </label>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options, required = false }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">{label}{required ? <span className="text-red-500"> *</span> : null}</label>
      <div className="relative">
        <select
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 pr-8 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all bg-white"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
          <i className="ti ti-chevron-down text-[12px]" />
        </span>
      </div>
    </div>
  );
}

export default function EmployeeStaffPage() {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [checkedRows, setCheckedRows] = useState([]);
  const [allChecked, setAllChecked] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [stores, setStores] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [passwordRequests, setPasswordRequests] = useState([]);
  const [passwordRequestsLoading, setPasswordRequestsLoading] = useState(false);
  const [form, setForm] = useState(() => ({ ...INITIAL_FORM }));
  const bulkRef = useRef(null);

  useEffect(() => {
    document.title = 'Employees';
  }, []);

  const loadPasswordRequests = useCallback(async () => {
    setPasswordRequestsLoading(true);
    try {
      const requests = await fetchPasswordChangeRequests();
      setPasswordRequests(requests);
    } catch (err) {
      console.error('Failed to load password requests', err);
      setPasswordRequests([]);
    } finally {
      setPasswordRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPasswordRequests();
  }, [loadPasswordRequests]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    fetchEmployees()
      .then((data) => {
        if (!cancelled) setEmployees(Array.isArray(data) ? data.map(mapEmployeeRow) : []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load employees', err);
          setEmployees([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchRoles(), fetchPermissions(), fetchDepartments(), fetchStores(), fetchWarehouses()])
      .then(([roleData, permissionData, departmentData, storeData, warehouseData]) => {
        if (cancelled) return;
        setRoles(Array.isArray(roleData) ? roleData : []);
        setPermissions(Array.isArray(permissionData) ? permissionData : []);
        setDepartments(Array.isArray(departmentData) ? departmentData : []);
        setStores(Array.isArray(storeData) ? storeData : []);
        setWarehouses(Array.isArray(warehouseData) ? warehouseData : []);
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load employee lookups', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (bulkRef.current && !bulkRef.current.contains(event.target)) setBulkOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const permissionOptions = useMemo(
    () => permissions.map((permission) => ({
      value: permission.permissionName || permission.permission_name,
      label: permission.displayName || permission.display_name || permission.permissionName || permission.permission_name,
    })).filter((permission) => permission.value),
    [permissions]
  );

  const roleOptions = useMemo(
    () => [
      { value: '', label: 'Select role' },
      ...roles.map((role) => ({
        value: String(role.id),
        label: role.roleName || role.role_name || `Role ${role.id}`,
      })),
    ],
    [roles]
  );

  const departmentOptions = useMemo(
    () => [
      { value: '', label: 'Select department' },
      ...departments.map((department) => ({
        value: String(department.id),
        label: department.departmentName || department.department_name || `Department ${department.id}`,
      })),
    ],
    [departments]
  );

  const storeOptions = useMemo(
    () => stores.map((store) => ({
      value: String(store.id),
      label: `${store.name}${store.city ? ` (${store.city}, ${store.state || ''})` : ''}`.trim(),
    })),
    [stores]
  );

  const warehouseOptions = useMemo(
    () => warehouses.map((warehouse) => ({
      value: String(warehouse.id),
      label: `${warehouse.name}${warehouse.manager_name ? ` - Mgr: ${warehouse.manager_name}` : ''}`,
    })),
    [warehouses]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((row) =>
      Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(q))
    );
  }, [employees, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalCount = filtered.length;
  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, totalCount);

  useEffect(() => {
    setAllChecked(paginated.length > 0 && paginated.every((row) => checkedRows.includes(row.id)));
  }, [checkedRows, paginated]);

  const handleAllCheck = () => {
    if (allChecked) {
      setCheckedRows([]);
      setAllChecked(false);
    } else {
      setCheckedRows(paginated.map((row) => row.id));
      setAllChecked(true);
    }
  };

  const handleRowCheck = (id) => {
    setCheckedRows((prev) => (
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    ));
  };

  const resetForm = () => {
    setForm({ ...INITIAL_FORM });
    setEditingId(null);
  };

  const handleEdit = (employee) => {
    setForm({
      ...INITIAL_FORM,
      firstName: employee.firstName ?? '',
      lastName: employee.lastName ?? '',
      username: employee.username ?? '',
      gender: employee.gender || 'Male',
      password: '',
      confirmPassword: '',
      mobileNumber: employee.mobileNumber ?? '',
      emailAddress: employee.emailAddress ?? '',
      roleName: employee.role || '',
      permissions: Array.isArray(employee.permissions) ? employee.permissions : [],
      regionStore: parseMultiValue(employee.regionStore),
      warehouse: parseMultiValue(employee.warehouse),
      departmentId: employee.department ? String(departments.find((d) => (d.departmentName || d.department_name) === employee.department)?.id || '') : '',
      customerName: employee.customerName ?? '',
      userType: employee.userType || 'Regular',
      dateOfBirth: employee.dateOfBirth || '',
      dateOfJoining: employee.dateOfJoining || '',
      dateOfLeaving: employee.dateOfLeaving || '',
      employeeCode: employee.employeeCode ?? '',
      createCustomerSameDetails: Boolean(employee.createCustomerSameDetails),
      employmentType: employee.employeeType || 'Payroll',
      address: employee.address ?? '',
      employmentStatus: employee.employmentStatus || 'Active',
      contractorName: employee.contractorName ?? '',
      discountLimitType: employee.discountLimitType || 'Percentage',
      discountLimitValue: employee.discountLimitValue ?? '',
      maximumDiscountAmount: employee.maximumDiscountAmount ?? '',
    });
    setEditingId(employee.id);
    setShowCreate(true);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      await deleteEmployee(deleteConfirm);
      setEmployees((current) => current.filter((emp) => emp.id !== deleteConfirm));
      setDeleteConfirm(null);
      alert('Employee deleted successfully!');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to delete employee');
    }
  };

  const handlePasswordRequestAction = async (requestId, action) => {
    try {
      await updatePasswordChangeRequest(requestId, action);
      await loadPasswordRequests();
      alert(
        action === 'approve'
          ? 'Password request approved. Employee will be logged out in 5 minutes.'
          : 'Password request rejected.'
      );
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to update password request');
    }
  };

  const handleSave = async () => {
    if (!form.firstName.trim()) return alert('First name is required');
    if (!form.username.trim()) return alert('Username is required');
    if (!form.mobileNumber.trim()) return alert('Mobile number is required');
    if (!/^\d{10}$/.test(form.mobileNumber)) return alert('Mobile number must be exactly 10 digits');
    if (!form.emailAddress.trim()) return alert('Email address is required');
    if (!isValidEmail(form.emailAddress)) return alert('Enter a valid email address');
    if (!form.roleName.trim()) return alert('Role is required');
    if (!editingId && !form.password.trim()) return alert('Password is required');
    if (!editingId && !form.confirmPassword.trim()) return alert('Confirm password is required');
    if (form.password && form.password !== form.confirmPassword) return alert('Passwords do not match');
    if (form.permissions.length === 0) return alert('Select at least one permission');

    const systemRole = form.roleName.trim().toLowerCase().replace(/\s+/g, '_');
    if ((systemRole === 'admin' || systemRole === 'manager') && form.regionStore.length === 0) {
      return alert('Select a store for Admin/Manager access');
    }

    setSaving(true);
    try {
      const payload = {
        first_name: form.firstName,
        last_name: form.lastName,
        username: form.username,
        gender: form.gender,
        mobile_number: form.mobileNumber.trim(),
        email_address: form.emailAddress.trim(),
        role_id: null,
        role_name: form.roleName.trim(),
        assigned_stores: form.regionStore.map(Number).filter(Number.isFinite),
        permissions: form.permissions,
        region_store: form.regionStore.join(','),
        warehouse: form.warehouse.join(','),
        department_id: form.departmentId ? Number(form.departmentId) : null,
        department_name: departments.find((department) => String(department.id) === String(form.departmentId))?.departmentName || '',
        customer_name: form.customerName,
        user_type: form.userType,
        date_of_birth: form.dateOfBirth || null,
        date_of_joining: form.dateOfJoining || null,
        date_of_leaving: form.dateOfLeaving || null,
        employee_code: form.employeeCode,
        create_customer_same_details: form.createCustomerSameDetails,
        employment_type: form.employmentType,
        address: form.address,
        employment_status: form.employmentStatus,
        contractor_name: form.contractorName,
        discount_limit_type: form.discountLimitType,
        discount_limit_value: form.discountLimitValue === '' ? null : Number(form.discountLimitValue),
        maximum_discount_amount: form.maximumDiscountAmount === '' ? null : Number(form.maximumDiscountAmount),
      };

      if (form.password) {
        payload.password = form.password;
        payload.confirm_password = form.confirmPassword;
      }

      if (editingId) {
        const updated = await updateEmployee(editingId, payload);
        setEmployees((current) => current.map((emp) => (emp.id === editingId ? mapEmployeeRow(updated.employee || updated) : emp)));
      } else {
        const created = await createEmployee(payload);
        setEmployees((current) => [mapEmployeeRow(created), ...current]);
      }

      setShowCreate(false);
      resetForm();
      setPage(1);
      alert(editingId ? 'Employee updated successfully!' : 'Employee created successfully!');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-5">
          <Link href="/employee" className="text-blue-600 hover:underline font-medium">Employee</Link>
          <i className="ti ti-chevron-right text-[11px] text-gray-400" />
          <span className="text-blue-600 font-semibold">Employees</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-gray-900">Employees</h1>
            <p className="text-[12.5px] text-gray-500 mt-1">
              List of all the users and respective stores.{' '}
              <span className="text-blue-600 cursor-pointer hover:underline font-medium">Need Help?</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative" ref={bulkRef}>
              <button
                onClick={() => setBulkOpen((current) => !current)}
                className="flex items-center gap-1.5 px-4 py-2 border border-blue-600 text-blue-600 bg-white rounded-lg text-[12.5px] font-semibold hover:bg-blue-50 transition-colors shadow-sm"
              >
                Bulk Operations
                <i className={`ti ti-chevron-down text-[12px] transition-transform ${bulkOpen ? 'rotate-180' : ''}`} />
              </button>
              {bulkOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  {['Export', 'Deactivate Selected', 'Delete Selected'].map((operation) => (
                    <button
                      key={operation}
                      onClick={() => setBulkOpen(false)}
                      className="block w-full text-left px-4 py-2 text-[12.5px] text-gray-700 hover:bg-gray-50 transition"
                    >
                      {operation}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => { setEditingId(null); setShowCreate(true); resetForm(); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white rounded-lg text-[12.5px] font-semibold hover:bg-blue-800 transition-colors shadow-sm"
            >
              <i className="ti ti-plus text-[14px]" />
              Create Employee
            </button>
          </div>
        </div>

        {(passwordRequestsLoading || passwordRequests.length > 0) && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-bold text-amber-950">Password Change Requests</h2>
                <p className="mt-0.5 text-[12px] text-amber-800">
                  Approving a request activates the new password after 5 minutes.
                </p>
              </div>
              <button
                onClick={loadPasswordRequests}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100"
              >
                Refresh
              </button>
            </div>

            {passwordRequestsLoading ? (
              <div className="text-[12.5px] text-amber-800">Loading password requests...</div>
            ) : (
              <div className="space-y-2">
                {passwordRequests.map((request) => {
                  const employeeName =
                    [request.first_name, request.last_name].filter(Boolean).join(' ').trim() ||
                    request.user_name ||
                    request.username ||
                    request.user_email;

                  return (
                    <div
                      key={request.id}
                      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-gray-900">{employeeName}</div>
                        <div className="mt-0.5 text-[12px] text-gray-500">
                          {request.user_email} {request.role_name ? `- ${request.role_name}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePasswordRequestAction(request.id, 'reject')}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handlePasswordRequestAction(request.id, 'approve')}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end mb-4">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 w-full sm:w-[280px] shadow-sm">
            <i className="ti ti-search text-gray-400 text-[15px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="bg-transparent text-[13px] text-gray-700 outline-none flex-1 placeholder-gray-400 min-w-0"
            />
            {search && (
              <button onClick={() => setSearch('')}>
                <i className="ti ti-x text-gray-400 text-[13px]" />
              </button>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-[12.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-white">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={handleAllCheck}
                      className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer"
                    />
                  </th>
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        {column.label}
                        {column.key !== 'employmentStatus' && column.key !== 'actions' && (
                          <span className="text-gray-300 text-[10px] leading-none">↑↓</span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="text-center text-gray-400 py-16 text-[13px]">
                      Loading employees...
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="text-center text-gray-400 py-16 text-[13px]">
                      Staff list empty
                    </td>
                  </tr>
                ) : (
                  paginated.map((row, index) => (
                    <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={checkedRows.includes(row.id)}
                          onChange={() => handleRowCheck(row.id)}
                          className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer"
                        />
                      </td>
                      {columns.map((column) => {
                        if (column.key === 'actions') {
                          return (
                            <td key={column.key} className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleEdit(row)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                  title="Edit"
                                >
                                  <i className="ti ti-edit text-[16px]" />
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(row.id)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                                  title="Delete"
                                >
                                  <i className="ti ti-trash text-[16px]" />
                                </button>
                              </div>
                            </td>
                          );
                        }

                        const value = column.key === 'sno' ? startIndex + index : row[column.key];
                        return (
                          <td key={column.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                            {column.key === 'employmentStatus' && value ? (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                value === 'Active' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
                              }`}>
                                {value}
                              </span>
                            ) : (
                              value || <span className="text-gray-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <div className="relative">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="appearance-none border border-gray-300 rounded-lg px-3 py-1.5 pr-7 bg-white text-[12.5px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
            >
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
              <i className="ti ti-chevron-down text-[11px]" />
            </span>
          </div>
          <span className="text-[12.5px] text-gray-400">
            Showing {startIndex} to {endIndex} of {totalCount} staff(s)
          </span>

          {totalPages > 1 && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <i className="ti ti-chevron-left text-gray-600 text-[14px]" />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
                const pg = totalPages <= 5 ? index + 1 : page <= 3 ? index + 1 : page >= totalPages - 2 ? totalPages - 4 + index : page - 2 + index;
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={`w-8 h-8 rounded-lg text-[12.5px] font-semibold transition-colors ${page === pg ? 'bg-blue-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    {pg}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <i className="ti ti-chevron-right text-gray-600 text-[14px]" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-gray-900 mb-3">Delete Employee?</h2>
            <p className="text-[13px] text-gray-600 mb-6">
              Are you sure you want to delete this employee? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-[13px] font-semibold hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl p-6 max-h-[92vh] overflow-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-[16px] font-bold text-gray-900">{editingId ? 'Edit Employee' : 'Create Employee'}</h2>
                <p className="text-[12.5px] text-gray-500 mt-1">Fill the employee information and save it to the database.</p>
              </div>
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="p-1.5 rounded-lg hover:bg-gray-100">
                <i className="ti ti-x text-gray-500 text-[16px]" />
              </button>
            </div>

            <div className="border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm text-blue-700 font-semibold mb-6">Staff Information</h4>

              <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">First Name <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={form.firstName}
                    onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                    placeholder="First Name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Last Name</label>
                  <input
                    value={form.lastName}
                    onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                    placeholder="Last Name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Username <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    placeholder="Username"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <SelectField
                  label="Gender"
                  value={form.gender}
                  onChange={(gender) => setForm({ ...form, gender })}
                  options={[
                    { value: 'Male', label: 'Male' },
                    { value: 'Female', label: 'Female' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Password {editingId ? '(leave blank to keep current)' : <span className="text-red-500">*</span>}</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      required={!editingId}
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      placeholder="Password"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                    />
                    {!editingId && (
                      <button
                        type="button"
                        onClick={() => {
                          const password = randomPassword();
                          setForm((current) => ({ ...current, password, confirmPassword: password }));
                        }}
                        className="px-3 py-2 border border-blue-300 rounded-lg text-[12px] font-semibold text-blue-600 hover:bg-blue-50 transition-colors whitespace-nowrap"
                      >
                        Auto Generate
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Confirm Password {editingId ? '(if changing)' : <span className="text-red-500">*</span>}</label>
                  <input
                    type="password"
                    required={!editingId || !!form.password}
                    value={form.confirmPassword}
                    onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                    placeholder="Confirm Password"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Mobile Number <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    maxLength={10}
                    required
                    value={form.mobileNumber}
                    onChange={(event) => {
                      const value = event.target.value.replace(/\D/g, '').slice(0, 10);
                      setForm({ ...form, mobileNumber: value });
                    }}
                    placeholder="Mobile Number (10 digits)"
                    
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                  {form.mobileNumber && !validatePhoneNumber(form.mobileNumber).isValid && (
                    <p className="text-[11px] text-red-600 mt-1">{validatePhoneNumber(form.mobileNumber).error}</p>
                  )}
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Email Address <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    required
                    value={form.emailAddress}
                    onChange={(event) => setForm({ ...form, emailAddress: event.target.value })}
                    placeholder="Email Address"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Role <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={form.roleName}
                    onChange={(event) => setForm({ ...form, roleName: event.target.value })}
                    placeholder="Enter role name"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <MultiSelect
                  label="Permissions"
                  options={permissionOptions}
                  value={form.permissions}
                  onChange={(permissionsSelected) => setForm({ ...form, permissions: permissionsSelected })}
                  placeholder="Select permissions"
                  required
                />

                <MultiSelect
                  label="Regions & Stores"
                  options={storeOptions}
                  value={form.regionStore}
                  onChange={(regionStore) => setForm({ ...form, regionStore })}
                  placeholder="Select Store/Region"
                  showSelectAll
                />

                <MultiSelect
                  label="Warehouse"
                  options={warehouseOptions}
                  value={form.warehouse}
                  onChange={(warehouse) => setForm({ ...form, warehouse })}
                  placeholder="Select Warehouse"
                  showSelectAll
                />

                <SelectField
                  label="Employee Department"
                  value={form.departmentId}
                  onChange={(departmentId) => setForm({ ...form, departmentId })}
                  options={departmentOptions}
                />

                <SelectField
                  label="Employment Type"
                  value={form.employmentType}
                  onChange={(employmentType) => setForm({ ...form, employmentType })}
                  options={[
                    { value: 'Payroll', label: 'Payroll' },
                    { value: 'Contractor', label: 'Contractor' },
                    { value: 'Temporary', label: 'Temporary' },
                  ]}
                />

                <SelectField
                  label="User Type"
                  value={form.userType}
                  onChange={(userType) => setForm({ ...form, userType })}
                  options={[
                    { value: 'Regular', label: 'Regular' },
                    { value: 'Sales Person', label: 'Sales Person' },
                  ]}
                />

                {/* <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Date of Birth</label>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div> */}

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Date of Joining</label>
                  <input
                    type="date"
                    value={form.dateOfJoining}
                    onChange={(event) => setForm({ ...form, dateOfJoining: event.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                {/* <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Date of Leaving</label>
                  <input
                    type="date"
                    value={form.dateOfLeaving}
                    onChange={(event) => setForm({ ...form, dateOfLeaving: event.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div> */}

                {/* <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Employee Code</label>
                  <input
                    value={form.employeeCode}
                    onChange={(event) => setForm({ ...form, employeeCode: event.target.value })}
                    placeholder="Employee Code"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div> */}

                {/* <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    checked={form.createCustomerSameDetails}
                    onChange={(event) => setForm({ ...form, createCustomerSameDetails: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-[12px] text-gray-700">Create a customer with same details</span>
                </div> */}
              </div>
            </div>

            {/* <div className="border border-gray-200 rounded-xl p-5 mt-6">
              <h4 className="text-sm text-blue-700 font-semibold mb-6">Discount Limits</h4>

              <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                <SelectField
                  label="Discount Limit Type"
                  value={form.discountLimitType}
                  onChange={(discountLimitType) => setForm({ ...form, discountLimitType })}
                  options={[
                    { value: 'Percentage', label: 'Percentage' },
                    { value: 'Amount', label: 'Amount' },
                  ]}
                />

                <div>
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Discount Limit Value</label>
                  <input
                    type="number"
                    value={form.discountLimitValue}
                    onChange={(event) => setForm({ ...form, discountLimitValue: event.target.value })}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Maximum Discount Amount</label>
                  <input
                    type="number"
                    value={form.maximumDiscountAmount}
                    onChange={(event) => setForm({ ...form, maximumDiscountAmount: event.target.value })}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                  />
                </div>
              </div>
            </div> */}

            <div className="grid grid-cols-2 gap-x-12 gap-y-6 mt-6">
              <div>
                <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Contractor Name</label>
                <input
                  value={form.contractorName}
                  onChange={(event) => setForm({ ...form, contractorName: event.target.value })}
                  placeholder="Contractor Name"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                />
              </div>

              <SelectField
                label="Employment Status"
                value={form.employmentStatus}
                onChange={(employmentStatus) => setForm({ ...form, employmentStatus })}
                options={[
                  { value: 'Active', label: 'Active' },
                  { value: 'Inactive', label: 'Inactive' },
                ]}
              />
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setShowCreate(false); resetForm(); }}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 bg-blue-700 text-white rounded-lg text-[13px] font-semibold hover:bg-blue-800 transition-colors"
                disabled={saving}
              >
                {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
