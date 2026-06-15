'use client';

import { useEffect, useMemo, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import { formatIndianDate } from '@/lib/dateUtils';

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toFixed(2);
}

function formatDate(value) {
  return formatIndianDate(value, '-');
}

export default function InactiveCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const fetchInactiveCustomers = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/customers?status=Inactive');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch inactive customers');
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setCustomers([]);
      setError(err.message || 'Failed to fetch inactive customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInactiveCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;

    return customers.filter((customer) =>
      [customer.name, customer.mobile_number, customer.email_address, customer.customer_type, customer.status]
        .some((value) => String(value ?? '').toLowerCase().includes(query))
    );
  }, [customers, search]);

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4 flex-wrap">
        <span className="text-blue-600">Customer</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Inactive Customers</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Inactive Customers</h1>
          <p className="text-[12.5px] text-gray-400 mt-1">Customers with status set to Inactive in the database</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 justify-between flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[340px] bg-gray-50 rounded-lg px-3 py-2">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="text-[12px] text-gray-500">
            Showing {filteredCustomers.length} inactive customer{filteredCustomers.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">S. No.</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">Phone</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">Email</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">Total Sales</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">Created At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-[13px] text-gray-500" colSpan={7}>Loading...</td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-[13px] text-gray-500" colSpan={7}>
                    {error || 'No inactive customers found'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer, index) => (
                  <tr key={customer.id} className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-gray-700">{index + 1}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{customer.name || '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{customer.mobile_number || '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{customer.email_address || '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{formatMoney(customer.total_sales)}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{customer.status || 'Inactive'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{formatDate(customer.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}
