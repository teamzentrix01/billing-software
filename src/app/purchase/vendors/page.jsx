 'use client';

import { useEffect, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { fetchLookup, normalizeVendors } from '@/lib/purchaseLookups';

const tableHeaders = ['S. No.', 'Vendor Name', 'Mobile Number', 'Email Address', 'Address', 'Actions'];

const DISTRIBUTION_VIA_OPTIONS = [
  { value: 'company', label: 'Company' },
  { value: 'distributor', label: 'Distributor' },
];

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeDistributionVia(value) {
  return String(value || '').trim().toLowerCase() === 'distributor' ? 'distributor' : 'company';
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const emptyForm = {
    id: null,
    name: '',
    company: '',
    business: 'company',
    address_1: '',
    address_2: '',
    city: '',
    state: '',
    pincode: '',
    country: '',
    email: '',
    mobile_number: '',
    gst_number: '',
    margin: 0,
    brand_ids: [],
    is_active: true,
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    fetchVendors();
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    try {
      const data = await fetchLookup('/api/catalog/brands?pageSize=1000');
      const records = Array.isArray(data?.data?.records)
        ? data.data.records
        : Array.isArray(data?.records)
          ? data.records
          : [];
      setBrands(records.filter((brand) => brand?.is_active !== false));
    } catch (err) {
      console.error('Failed to fetch brands', err);
      setBrands([]);
    }
  };

  const fetchVendors = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      params.set('includeInactive', 'true');
      const data = await fetchLookup(`/api/vendors?${params.toString()}`);
      setVendors(normalizeVendors(data));
    } catch (err) {
      console.error('Failed to fetch vendors', err);
      setVendors([]);
      setError(err.message || 'Failed to fetch vendors');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchVendors, 250);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (vendor) => {
    setForm({
      ...emptyForm,
      ...vendor,
      business: normalizeDistributionVia(vendor.business),
      margin: Number(vendor.margin || 0),
      brand_ids: Array.isArray(vendor.brand_ids)
        ? vendor.brand_ids.map((id) => String(id))
        : [],
      is_active: vendor.is_active !== false,
    });
    setShowModal(true);
  };

  const handleDelete = async (vendor) => {
    if (!window.confirm(`Delete vendor ${vendor.name}? Used vendors will be archived.`)) return;
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      fetchVendors();
    } catch (err) {
      alert(err.message || 'Failed to delete vendor');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Vendor name is required');
    if (!form.mobile_number.trim()) return alert('Mobile number is required');
    if (!/^\d{10}$/.test(form.mobile_number)) return alert('Mobile number must be exactly 10 digits');
    if (!form.gst_number.trim()) return alert('GST number is required');
    if (!Array.isArray(form.brand_ids) || form.brand_ids.length === 0) return alert('Please select at least one brand');
    if (form.email.trim() && !isValidEmail(form.email)) return alert('Enter a valid email address');
    setSaving(true);
    try {
      const res = await fetch(form.id ? `/api/vendors/${form.id}` : '/api/vendors', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setShowModal(false);
      setForm(emptyForm);
      fetchVendors();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to save vendor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Purchase</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Vendors</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Vendors</h1>
          <p className="text-[12.5px] text-gray-400 mt-1">Descriptive Text Need Help?</p>
        </div>

        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-[13px] font-medium text-white hover:bg-blue-700 transition-colors flex-shrink-0">
          <i className="ti ti-plus text-[16px]" />
          Create Vendor
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {error && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-600">
            {error}
          </div>
        )}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 justify-between flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[340px] bg-gray-50 rounded-lg px-3 py-2">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              <i className="ti ti-download text-gray-500 text-[16px]" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b border-gray-100">
                {tableHeaders.map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-6" colSpan={6}>Loading...</td></tr>
              ) : vendors.length === 0 ? (
                <tr><td className="px-4 py-6" colSpan={6}>No vendors found</td></tr>
              ) : (
                vendors.map((row, rowIdx) => (
                  <tr key={row.id || rowIdx} className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-gray-700">{rowIdx + 1}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">
                      <div className="font-medium text-gray-900">{row.name || '-'}</div>
                      <div className="text-[11px] text-gray-500">{row.company || row.business || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{row.mobile_number || '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{row.email || '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">{[row.address_1, row.address_2, row.city, row.state, row.pincode].filter(Boolean).join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(row)} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50" title="Edit vendor">
                          <i className="ti ti-edit text-[15px]" />
                        </button>
                        <button onClick={() => handleDelete(row)} className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50" title="Delete vendor">
                          <i className="ti ti-trash text-[15px]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-400">
          <select className="border border-gray-200 rounded-lg px-3 py-2 bg-white text-[12px] text-gray-600">
            <option>10</option>
            <option>20</option>
            <option>50</option>
          </select>
          <span>Showing {vendors.length} Results</span>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-[1000px] bg-white rounded-lg border border-gray-300 shadow-lg overflow-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{form.id ? 'Edit Vendor' : 'Create Vendor'}</h3>
              <button className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100" onClick={() => setShowModal(false)}>
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <section className="border border-gray-300 rounded p-4 bg-white">
                <h4 className="text-sm text-blue-700 font-semibold mb-3">Basic Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[12px] text-gray-700">Vendor Name *</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-[12px] text-gray-700">Vendor Company</label>
                    <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>

                  <div>
                    <label className="text-[12px] text-gray-700">Distribution Via</label>
                    <select value={form.business} onChange={(e) => setForm({ ...form, business: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500">
                      {DISTRIBUTION_VIA_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="border border-gray-300 rounded p-4 bg-white">
                <h4 className="text-sm text-blue-700 font-semibold mb-3">Address Information</h4>
                <div className="space-y-3">
                  <input value={form.address_1} onChange={(e) => setForm({ ...form, address_1: e.target.value })} placeholder="Address 1" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  <input value={form.address_2} onChange={(e) => setForm({ ...form, address_2: e.target.value })} placeholder="Address 2" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />

                  <div className="grid grid-cols-2 gap-3">
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                    <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} placeholder="Pincode" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                    <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Country" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] text-gray-700">Email Address</label>
                      <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email Address" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[12px] text-gray-700">Mobile Number <span className="text-red-500">*</span></label>
                      <input 
                        value={form.mobile_number} 
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setForm({ ...form, mobile_number: digits });
                        }}
                        placeholder="Mobile Number (10 digits)" 
                        maxLength="10"
                        className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" 
                      />
                      {form.mobile_number && !validatePhoneNumber(form.mobile_number).isValid && (
                        <p className="text-[11px] text-red-600 mt-0.5">{validatePhoneNumber(form.mobile_number).error}</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="border border-gray-300 rounded p-4 bg-white">
                <h4 className="text-sm text-blue-700 font-semibold mb-3">Other Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[12px] text-gray-700">GST Number *</label>
                    <input value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>

                  <div className="col-span-2">
                    <label className="text-[12px] text-gray-700">Vendor Margin(%)</label>
                    <input type="number" value={form.margin} onChange={(e) => setForm({ ...form, margin: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white placeholder:text-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="col-span-2">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-[12px] text-gray-700">Brands *</label>
                      {brands.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              brand_ids:
                                current.brand_ids.length === brands.length
                                  ? []
                                  : brands.map((brand) => String(brand.id)),
                            }))
                          }
                          className="text-[12px] font-semibold text-blue-600 hover:underline"
                        >
                          {form.brand_ids.length === brands.length ? 'Clear all' : 'Select all'}
                        </button>
                      )}
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-300 p-3">
                      {brands.length ? (
                        <div className="grid grid-cols-2 gap-2">
                          {brands.map((brand) => (
                            <label key={brand.id} className="flex items-center gap-2 text-[13px] text-gray-700">
                              <input
                                type="checkbox"
                                checked={form.brand_ids.includes(String(brand.id))}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    brand_ids: event.target.checked
                                      ? [...current.brand_ids, String(brand.id)]
                                      : current.brand_ids.filter((id) => id !== String(brand.id)),
                                  }))
                                }
                              />
                              <span>{brand.name}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-gray-500">No brands found.</p>
                      )}
                    </div>
                  </div>
                  <label className="col-span-2 flex items-center gap-2 text-[12px] text-gray-700">
                    <input type="checkbox" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                    Active vendor
                  </label>
                </div>
              </section>

              <div className="flex items-center justify-end gap-3">
                <button className="px-4 py-2 rounded-lg border border-gray-200 bg-white" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : form.id ? 'Update' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
