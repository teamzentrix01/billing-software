"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';

const initialForm = {
  name: '',
  locationType: 'Store',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: 'Uttar Pradesh',
  pincode: '',
  country: 'India',
  latitude: '',
  longitude: '',
  panNumber: '',
  managerName: '',
  managerMobile: '',
  managerEmail: '',
  openingTime: '10:00 am',
  closingTime: '10:00 pm',
  defaultCustomerGroup: 'None',
  storeCode: '',
  storeArea: '',
  enableVoucherValidation: false,
  automaticPrint: false,
  enableStoreStockAlert: false,
  enableStoreOnlineBillingOnly: false,
  cin: '',
  tin: '',
  serviceTaxNumber: '',
  gstNumber: '',
  customerGstOrderPrefix: '',
  fssaiLicenseNumber: '',
  taxInformation: '',
  customStoreOrderPrefix: '',
  refundCustomStoreOrderPrefix: '',
  ncCustomStoreOrderPrefix: '',
  ncRefundCustomStoreOrderPrefix: '',
  rwiCustomStoreOrderPrefix: '',
};

export default function EditStorePage() {
  const params = useParams();
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stores/${params.id}`);
        const json = await res.json();
        if (!mounted) return;

        if (!res.ok || !json.success) {
          setError(json.message || 'Failed to load store');
          return;
        }

        const store = json.data.store;
        const meta = store.meta || {};
        setForm({
          ...initialForm,
          name: store.name || '',
          addressLine1: store.address_line1 || '',
          addressLine2: store.address_line2 || '',
          city: store.city || '',
          state: store.state || 'Uttar Pradesh',
          pincode: store.pincode || '',
          country: store.country || 'India',
          managerName: store.manager_name || '',
          managerMobile: store.manager_mobile || '',
          managerEmail: store.manager_email || '',
          openingTime: store.opening_time || '10:00 am',
          closingTime: store.closing_time || '10:00 pm',
          locationType: meta.locationType || 'Store',
          latitude: meta.latitude || '',
          longitude: meta.longitude || '',
          panNumber: meta.panNumber || '',
          defaultCustomerGroup: meta.defaultCustomerGroup || 'None',
          storeCode: meta.storeCode || meta.shortCode || '',
          storeArea: meta.storeArea || '',
          enableVoucherValidation: !!meta.enableVoucherValidation,
          automaticPrint: !!meta.automaticPrint,
          enableStoreStockAlert: !!meta.enableStoreStockAlert,
          enableStoreOnlineBillingOnly: !!meta.enableStoreOnlineBillingOnly,
          cin: meta.cin || '',
          tin: meta.tin || '',
          serviceTaxNumber: meta.serviceTaxNumber || '',
          gstNumber: meta.gstNumber || '',
          customerGstOrderPrefix: meta.customerGstOrderPrefix || '',
          fssaiLicenseNumber: meta.fssaiLicenseNumber || '',
          taxInformation: meta.taxInformation || '',
          customStoreOrderPrefix: meta.customStoreOrderPrefix || '',
          refundCustomStoreOrderPrefix: meta.refundCustomStoreOrderPrefix || '',
          ncCustomStoreOrderPrefix: meta.ncCustomStoreOrderPrefix || '',
          ncRefundCustomStoreOrderPrefix: meta.ncRefundCustomStoreOrderPrefix || '',
          rwiCustomStoreOrderPrefix: meta.rwiCustomStoreOrderPrefix || '',
        });
      } catch {
        if (mounted) setError('Failed to load store');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [params.id]);

  const onChange = (e) => {
    const value = e.target.name === 'managerMobile'
      ? e.target.value.replace(/\D/g, '').slice(0, 10)
      : e.target.name === 'pincode'
      ? e.target.value.replace(/\D/g, '').slice(0, 6)
      : e.target.value;
    setForm((p) => ({ ...p, [e.target.name]: value }));
  };
  const onCheck = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.checked }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const requiredFields = [
      ['name', 'Store name is required'],
      ['locationType', 'Location type is required'],
      ['addressLine1', 'Address line 1 is required'],
      ['city', 'City is required'],
      ['state', 'State is required'],
      ['pincode', 'Pincode is required'],
      ['country', 'Country is required'],
      ['storeCode', 'Store code is required'],
    ];
    const missing = requiredFields.find(([key]) => !String(form[key] || '').trim());
    if (missing) {
      setError(missing[1]);
      return;
    }
    if (!/^\d{6}$/.test(String(form.pincode || '').trim())) {
      setError('Pincode must be 6 digits');
      return;
    }
    if (form.managerMobile && !/^\d{10}$/.test(form.managerMobile)) {
      setError('Mobile number must be exactly 10 digits');
      return;
    }
    if (form.managerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.managerEmail.trim())) {
      setError('Enter a valid e-mail address');
      return;
    }
    setSaving(true);

    try {
      const res = await fetch(`/api/stores/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || 'Failed to update store');
        return;
      }

      setSuccess('Store updated successfully');
    } catch {
      setError('Failed to update store');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <p className="text-sm text-gray-500">Loading store...</p>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Edit Store</h2>
          <p className="text-sm text-gray-500">Update store details and save changes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push(`/settings/stores/${params.id}`)} className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50">View</button>
          <button form="edit-store-form" type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <form id="edit-store-form" onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Basic Information</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Store Name *"><input name="name" value={form.name} onChange={onChange} required className="input" /></Field>
            <Field label="Location Type"><input name="locationType" value={form.locationType} onChange={onChange} className="input" /></Field>
            <Field label="Address Line 1 *"><input name="addressLine1" value={form.addressLine1} onChange={onChange} required className="input" /></Field>
            <Field label="Address Line 2"><input name="addressLine2" value={form.addressLine2} onChange={onChange} className="input" /></Field>
            <Field label="City *"><input name="city" value={form.city} onChange={onChange} required className="input" /></Field>
            <Field label="State *"><input name="state" value={form.state} onChange={onChange} required className="input" /></Field>
            <Field label="Pincode *"><input name="pincode" value={form.pincode} onChange={onChange} required maxLength={6} inputMode="numeric" className="input" /></Field>
            <Field label="Country *"><input name="country" value={form.country} onChange={onChange} required className="input" /></Field>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Store Information</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Manager Name"><input name="managerName" value={form.managerName} onChange={onChange} className="input" /></Field>
            <Field label="Mobile Number"><input name="managerMobile" type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={form.managerMobile} onChange={onChange} className="input" /></Field>
            <Field label="E-mail Address"><input name="managerEmail" type="email" value={form.managerEmail} onChange={onChange} className="input" /></Field>
            <Field label="Opening Time"><input name="openingTime" value={form.openingTime} onChange={onChange} className="input" /></Field>
            <Field label="Closing Time"><input name="closingTime" value={form.closingTime} onChange={onChange} className="input" /></Field>
            <Field label="Store Code *"><input name="storeCode" value={form.storeCode} onChange={onChange} required className="input" /></Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <Toggle label="Enable Voucher Validation" name="enableVoucherValidation" checked={form.enableVoucherValidation} onChange={onCheck} />
            <Toggle label="Automatic Print" name="automaticPrint" checked={form.automaticPrint} onChange={onCheck} />
            <Toggle label="Enable Store Stock Alert" name="enableStoreStockAlert" checked={form.enableStoreStockAlert} onChange={onCheck} />
            <Toggle label="Enable Store Online Billing Only" name="enableStoreOnlineBillingOnly" checked={form.enableStoreOnlineBillingOnly} onChange={onCheck} />
          </div>
        </section>

        {(error || success) && (
          <p className={`text-sm ${error ? 'text-red-600' : 'text-green-600'}`}>{error || success}</p>
        )}
      </form>

      <style jsx>{`
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          background: white;
        }
        .input:focus {
          outline: none;
          border-color: #B00000;
          box-shadow: 0 0 0 1px #B00000;
        }
      `}</style>
    </MainLayout>
  );
}

function Field({ label, children }) {
  const isRequired = String(label || '').trim().endsWith('*');
  const displayLabel = isRequired ? String(label).replace(/\s*\*$/, '') : label;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{displayLabel}{isRequired ? <span className="text-red-500"> *</span> : null}</span>
      {children}
    </label>
  );
}

function Toggle({ label, name, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input name={name} type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-blue-600" />
    </label>
  );
}
