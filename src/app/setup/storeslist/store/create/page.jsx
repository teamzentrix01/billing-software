"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function CreateStorePage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [savedStore, setSavedStore] = useState(null);

  const onChange = (e) => {
    const value = e.target.name === 'managerMobile'
      ? e.target.value.replace(/\D/g, '').slice(0, 10)
      : e.target.value;
    setForm((p) => ({ ...p, [e.target.name]: value }));
    if (errors[e.target.name]) {
      setErrors((p) => ({ ...p, [e.target.name]: '' }));
    }
  };
  const onCheck = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.checked }));

  const inputClass = (field) => `input ${errors[field] ? 'input-error' : ''}`;

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Store name is required';
    if (!form.locationType) next.locationType = 'Location type is required';
    if (!form.addressLine1.trim()) next.addressLine1 = 'Address line 1 is required';
    if (!form.city.trim()) next.city = 'City is required';
    if (!form.state.trim()) next.state = 'State is required';
    if (!form.pincode.trim()) next.pincode = 'Pincode is required';
    else if (!/^\d{6}$/.test(form.pincode.trim())) next.pincode = 'Pincode must be 6 digits';
    if (!form.country.trim()) next.country = 'Country is required';
    if (!form.storeCode.trim()) next.storeCode = 'Store code is required';
    if (form.managerMobile && !/^\d{10}$/.test(form.managerMobile)) {
      next.managerMobile = 'Mobile number must be exactly 10 digits';
    }
    if (form.managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.managerEmail.trim())) {
      next.managerEmail = 'Enter a valid e-mail address';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) {
      setError('Please fix the highlighted fields');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || 'Failed to create store');
        return;
      }
      setSavedStore(json.data?.store || null);
    } catch (err) {
      setError(err.message || 'Failed to create store');
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Create Store</h2>
          <p className="text-sm text-gray-500">Add store address, contact and billing settings.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push('/settings/stores')} className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50">Back</button>
          {!savedStore && (
            <button form="create-store-form" type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              {loading ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {savedStore ? (
        <div className="space-y-5">
          <section className="bg-white border border-green-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[15px] font-semibold text-green-700">Store saved successfully</h3>
                <p className="text-sm text-gray-500 mt-1">The store has been created and its details are shown below.</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <div>Store Code: {savedStore.meta?.storeCode || savedStore.meta?.shortCode || form.storeCode || '—'}</div>
                <div>Status: {savedStore.is_active ? 'Active' : 'Inactive'}</div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Basic Information</h3>
            <DetailGrid items={[
              ['Store Name', savedStore.name],
              ['Location Type', savedStore.meta?.locationType || form.locationType],
              ['Address Line 1', savedStore.address_line1 || form.addressLine1],
              ['Address Line 2', savedStore.address_line2 || form.addressLine2],
              ['City', savedStore.city || form.city],
              ['State', savedStore.state || form.state],
              ['Pincode', savedStore.pincode || form.pincode],
              ['Country', savedStore.country || form.country],
              ['Latitude', savedStore.meta?.latitude || form.latitude],
              ['Longitude', savedStore.meta?.longitude || form.longitude],
              ['Pan Number', savedStore.meta?.panNumber || form.panNumber],
            ]} />
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Store Information</h3>
            <DetailGrid items={[
              ['Manager Name', savedStore.manager_name || form.managerName],
              ['Mobile Number', savedStore.manager_mobile || form.managerMobile],
              ['E-mail Address', savedStore.manager_email || form.managerEmail],
              ['Opening Time', savedStore.opening_time || form.openingTime],
              ['Closing Time', savedStore.closing_time || form.closingTime],
              ['Default Customer Group', savedStore.meta?.defaultCustomerGroup || form.defaultCustomerGroup],
              ['Store Code', savedStore.meta?.storeCode || savedStore.meta?.shortCode || form.storeCode],
              ['Store Area', savedStore.meta?.storeArea || form.storeArea],
              ['Voucher Validation', (savedStore.meta?.enableVoucherValidation ?? form.enableVoucherValidation) ? 'Yes' : 'No'],
              ['Automatic Print', (savedStore.meta?.automaticPrint ?? form.automaticPrint) ? 'Yes' : 'No'],
              ['Stock Alert', (savedStore.meta?.enableStoreStockAlert ?? form.enableStoreStockAlert) ? 'Yes' : 'No'],
              ['Online Billing Only', (savedStore.meta?.enableStoreOnlineBillingOnly ?? form.enableStoreOnlineBillingOnly) ? 'Yes' : 'No'],
            ]} />
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Receipt Settings</h3>
            <DetailGrid items={[
              ['CIN', savedStore.meta?.cin || form.cin],
              ['TIN', savedStore.meta?.tin || form.tin],
              ['Service Tax Number', savedStore.meta?.serviceTaxNumber || form.serviceTaxNumber],
              ['GST Number', savedStore.meta?.gstNumber || form.gstNumber],
              ['Customer GST Order Prefix', savedStore.meta?.customerGstOrderPrefix || form.customerGstOrderPrefix],
              ['FSSAI License Number', savedStore.meta?.fssaiLicenseNumber || form.fssaiLicenseNumber],
              ['Tax Information', savedStore.meta?.taxInformation || form.taxInformation],
            ]} />
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Custom Order Prefix</h3>
            <DetailGrid items={[
              ['Custom Store Order Prefix', savedStore.meta?.customStoreOrderPrefix || form.customStoreOrderPrefix],
              ['Refund Custom Store Order Prefix', savedStore.meta?.refundCustomStoreOrderPrefix || form.refundCustomStoreOrderPrefix],
              ['NC Custom Store Order Prefix', savedStore.meta?.ncCustomStoreOrderPrefix || form.ncCustomStoreOrderPrefix],
              ['NC Refund Custom Store Order Prefix', savedStore.meta?.ncRefundCustomStoreOrderPrefix || form.ncRefundCustomStoreOrderPrefix],
              ['RWI Custom Store Order Prefix', savedStore.meta?.rwiCustomStoreOrderPrefix || form.rwiCustomStoreOrderPrefix],
            ]} />
          </section>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSavedStore(null)} className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50">
              Create Another
            </button>
            <button type="button" onClick={() => router.push('/settings/stores')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Back to Stores List
            </button>
          </div>
        </div>
      ) : (
      <form id="create-store-form" onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Basic Information</h3>
          <div className="space-y-4">
            <Field label="Store Name *" error={errors.name}>
              <input name="name" value={form.name} onChange={onChange} className={inputClass('name')} placeholder="Noida Store" />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Location Type *" error={errors.locationType}>
                <select name="locationType" value={form.locationType} onChange={onChange} className={inputClass('locationType')}>
                  <option value="Store">Store</option>
                  <option value="Warehouse">Warehouse</option>
                  <option value="Outlet">Outlet</option>
                </select>
              </Field>
              <Field label="State *" error={errors.state}>
                <input name="state" value={form.state} onChange={onChange} className={inputClass('state')} placeholder="Uttar Pradesh" />
              </Field>
            </div>

            <Field label="Address Line 1 *" error={errors.addressLine1}>
              <input name="addressLine1" value={form.addressLine1} onChange={onChange} className={inputClass('addressLine1')} placeholder="6th floor, C55, Priska Tower" />
            </Field>

            <Field label="Address Line 2">
              <input name="addressLine2" value={form.addressLine2} onChange={onChange} className="input" placeholder="Sector - 62, Noida" />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="City *" error={errors.city}>
                <input name="city" value={form.city} onChange={onChange} className={inputClass('city')} placeholder="Noida" />
              </Field>
              <Field label="Pincode *" error={errors.pincode}>
                <input name="pincode" value={form.pincode} onChange={onChange} className={inputClass('pincode')} placeholder="201309" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Country *" error={errors.country}>
                <input name="country" value={form.country} onChange={onChange} className={inputClass('country')} />
              </Field>
              <Field label="Latitude">
                <input name="latitude" value={form.latitude} onChange={onChange} className="input" placeholder="28.61" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Longitude">
                <input name="longitude" value={form.longitude} onChange={onChange} className="input" placeholder="77.21" />
              </Field>
              <Field label="Pan Number">
                <input name="panNumber" value={form.panNumber} onChange={onChange} className="input" placeholder="ABCDE1234F" />
              </Field>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Store Contact & Operations</h3>
          <div className="space-y-4">
            <Field label="Store Contact Name">
              <input name="managerName" value={form.managerName} onChange={onChange} className="input" placeholder="John Doe" />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Contact Mobile" error={errors.managerMobile}>
                <input name="managerMobile" type="tel" inputMode="numeric" maxLength={10} value={form.managerMobile} onChange={onChange} className={inputClass('managerMobile')} placeholder="9958160899" />
              </Field>
              <Field label="Contact E-mail" error={errors.managerEmail}>
                <input name="managerEmail" type="email" value={form.managerEmail} onChange={onChange} className={inputClass('managerEmail')} placeholder="contact@queuebuster.co" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Opening Time">
                <input name="openingTime" value={form.openingTime} onChange={onChange} className="input" placeholder="10:00 am" />
              </Field>
              <Field label="Closing Time">
                <input name="closingTime" value={form.closingTime} onChange={onChange} className="input" placeholder="10:00 pm" />
              </Field>
            </div>

            <Field label="Default Customer Group">
              <input name="defaultCustomerGroup" value={form.defaultCustomerGroup} onChange={onChange} className="input" placeholder="None" />
            </Field>

            <Field label="Store Code *" error={errors.storeCode}>
              <input name="storeCode" value={form.storeCode} onChange={onChange} className={inputClass('storeCode')} placeholder="e.g. Noida-01" />
            </Field>

            <Field label="Store Area">
              <input name="storeArea" value={form.storeArea} onChange={onChange} className="input" placeholder="Area in sq m" />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Toggle label="Enable Voucher Validation" name="enableVoucherValidation" checked={form.enableVoucherValidation} onChange={onCheck} />
              <Toggle label="Automatic Print" name="automaticPrint" checked={form.automaticPrint} onChange={onCheck} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Toggle label="Enable Store Stock Alert" name="enableStoreStockAlert" checked={form.enableStoreStockAlert} onChange={onCheck} />
              <Toggle label="Enable Store Online Billing Only" name="enableStoreOnlineBillingOnly" checked={form.enableStoreOnlineBillingOnly} onChange={onCheck} />
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Receipt Settings</h3>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="CIN">
                <input name="cin" value={form.cin} onChange={onChange} className="input" />
              </Field>
              <Field label="TIN">
                <input name="tin" value={form.tin} onChange={onChange} className="input" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Service Tax Number">
                <input name="serviceTaxNumber" value={form.serviceTaxNumber} onChange={onChange} className="input" />
              </Field>
              <Field label="GST Number">
                <input name="gstNumber" value={form.gstNumber} onChange={onChange} className="input" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Customer GST Order Prefix">
                <input name="customerGstOrderPrefix" value={form.customerGstOrderPrefix} onChange={onChange} className="input" />
              </Field>
              <Field label="FSSAI License Number">
                <input name="fssaiLicenseNumber" value={form.fssaiLicenseNumber} onChange={onChange} className="input" />
              </Field>
            </div>

            <Field label="Tax Information">
              <input name="taxInformation" value={form.taxInformation} onChange={onChange} className="input" />
            </Field>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">Custom Order Prefix</h3>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Custom Store Order Prefix">
                <input name="customStoreOrderPrefix" value={form.customStoreOrderPrefix} onChange={onChange} className="input" />
              </Field>
              <Field label="Refund Custom Store Order Prefix">
                <input name="refundCustomStoreOrderPrefix" value={form.refundCustomStoreOrderPrefix} onChange={onChange} className="input" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="NC Custom Store Order Prefix">
                <input name="ncCustomStoreOrderPrefix" value={form.ncCustomStoreOrderPrefix} onChange={onChange} className="input" />
              </Field>
              <Field label="NC Refund Custom Store Order Prefix">
                <input name="ncRefundCustomStoreOrderPrefix" value={form.ncRefundCustomStoreOrderPrefix} onChange={onChange} className="input" />
              </Field>
            </div>

            <Field label="RWI Custom Store Order Prefix">
              <input name="rwiCustomStoreOrderPrefix" value={form.rwiCustomStoreOrderPrefix} onChange={onChange} className="input" />
            </Field>
          </div>
        </section>

        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>
      )}

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
        .input-error {
          border-color: #ef4444;
          background: #fff7f7;
        }
        .input-error:focus {
          border-color: #ef4444;
          box-shadow: 0 0 0 1px #ef4444;
        }
      `}</style>
    </MainLayout>
  );
}

function Field({ label, children, error }) {
  const isRequired = String(label || '').trim().endsWith('*');
  const displayLabel = isRequired ? String(label).replace(/\s*\*$/, '') : label;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{displayLabel}{isRequired ? <span className="text-red-500"> *</span> : null}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
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

function DetailGrid({ items }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs font-medium text-gray-500">{label}</div>
          <div className="mt-1 text-sm font-semibold text-gray-900">{value || '-'}</div>
        </div>
      ))}
    </div>
  );
}
