"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import MainLayout from "@/components/MainLayout";

const MIN_COST_PER_SQ_FT = 1400;
const FRANCHISE_TYPES = ["FOCM", "FOCO", "COCO"];
const DOCUMENT_FIELDS = [
  { key: "agreement", label: "Agreement", required: true },
  { key: "aadhaar", label: "Aadhaar", required: true },
  { key: "panCard", label: "PAN Card", required: true },
  { key: "rentAgreement", label: "Electricity Bill / Rent Agreement", required: true },
];
const INTERIOR_FIELDS = [
  { key: "ac", label: "AC" },
  { key: "refrigerator", label: "Refrigerator" },
  { key: "deepFreezer", label: "Deep Freezer" },
  { key: "racks", label: "Racks" },
  { key: "sealingMachine", label: "Sealing Machine" },
  { key: "weighingMachine", label: "Weighing Machine" },
  { key: "palletBoard", label: "Pallet Board" },
  { key: "bloombellBundle", label: "Bloombell Bundle" },
  { key: "bumbWell", label: "Bumb Well" },
  { key: "fireExtinguisher", label: "Fire Extinguisher" },
  { key: "ledBoard", label: "LED Board" },
  { key: "posMachine", label: "POS Machine" },
  {
    key: "billingThermalPrinterScanner",
    label: "Billing Thermal Printer Scanner",
  },
  { key: "billingCounter", label: "Billing Counter" },
  { key: "shoppingBasket", label: "Shopping Basket" },
  { key: "cart", label: "Cart" },
];
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ALLOWED_DOCUMENT_EXTENSIONS = [".pdf", ".jpg", ".png"];

const initialForm = {
  name: "",
  locationType: "Store",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "Uttar Pradesh",
  pincode: "",
  country: "India",
  panNumber: "",
  managerName: "",
  managerMobile: "",
  managerEmail: "",
  openingTime: "10:00 am",
  closingTime: "10:00 pm",
  defaultCustomerGroup: "None",
  storeCode: "",
  storeArea: "",
  storeAreaSqFt: "",
  costPerSqFt: String(MIN_COST_PER_SQ_FT),
  franchiseType: "",
  documents: DOCUMENT_FIELDS.reduce(
    (acc, field) => ({ ...acc, [field.key]: null }),
    {},
  ),
  interiorItems: INTERIOR_FIELDS.reduce(
    (acc, field) => ({
      ...acc,
      [field.key]: { enabled: false, amount: "", units: "", total: 0 },
    }),
    {},
  ),
  enableVoucherValidation: false,
  automaticPrint: false,
  enableStoreStockAlert: false,
  enableStoreOnlineBillingOnly: false,
  cin: "",
  tin: "",
  serviceTaxNumber: "",
  gstNumber: "",
  customerGstOrderPrefix: "",
  fssaiLicenseNumber: "",
  taxInformation: "",
  customStoreOrderPrefix: "",
  refundCustomStoreOrderPrefix: "",
  ncCustomStoreOrderPrefix: "",
  ncRefundCustomStoreOrderPrefix: "",
  rwiCustomStoreOrderPrefix: "",
};

function getStoreFormat(areaValue) {
  const area = Number(areaValue || 0);
  if (!Number.isFinite(area) || area <= 0) return "";
  if (area >= 600 && area < 1000) return "Mini Mart";
  if (area >= 1000 && area < 3000) return "Super Mart";
  if (area >= 3000) return "Hyper Mart";
  return "";
}

function getTotalAmount(areaValue, costValue) {
  const area = Number(areaValue || 0);
  const cost = Number(costValue || 0);
  if (
    !Number.isFinite(area) ||
    !Number.isFinite(cost) ||
    area <= 0 ||
    cost <= 0
  )
    return 0;
  return area * cost;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function getInteriorGrandTotal(items) {
  return Object.values(items || {}).reduce((sum, item) => {
    if (!item?.enabled) return sum;
    return sum + Number(item.total || 0);
  }, 0);
}

async function fileToDocument(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: String(reader.result || ""),
      });
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function EditStorePage() {
  const params = useParams();
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stores/${params.id}`);
        const json = await res.json();
        if (!mounted) return;

        if (!res.ok || !json.success) {
          setError(json.message || "Failed to load store");
          return;
        }

        const store = json.data.store;
        const meta = store.meta || {};
        setForm({
          ...initialForm,
          name: store.name || "",
          addressLine1: store.address_line1 || "",
          addressLine2: store.address_line2 || "",
          city: store.city || "",
          state: store.state || "Uttar Pradesh",
          pincode: store.pincode || "",
          country: store.country || "India",
          managerName: store.manager_name || "",
          managerMobile: store.manager_mobile || "",
          managerEmail: store.manager_email || "",
          openingTime: store.opening_time || "10:00 am",
          closingTime: store.closing_time || "10:00 pm",
          locationType: meta.locationType || "Store",
          panNumber: meta.panNumber || "",
          defaultCustomerGroup: meta.defaultCustomerGroup || "None",
          storeCode: meta.storeCode || meta.shortCode || "",
          storeArea: meta.storeAreaSqFt || meta.storeArea || "",
          storeAreaSqFt: meta.storeAreaSqFt || meta.storeArea || "",
          costPerSqFt: meta.costPerSqFt || String(MIN_COST_PER_SQ_FT),
          franchiseType: meta.franchiseType || "",
          documents: {
            ...initialForm.documents,
            ...(meta.documents && typeof meta.documents === "object"
              ? meta.documents
              : {}),
          },
          interiorItems: {
            ...initialForm.interiorItems,
            ...(meta.interiorItems && typeof meta.interiorItems === "object"
              ? meta.interiorItems
              : {}),
          },
          enableVoucherValidation: !!meta.enableVoucherValidation,
          automaticPrint: !!meta.automaticPrint,
          enableStoreStockAlert: !!meta.enableStoreStockAlert,
          enableStoreOnlineBillingOnly: !!meta.enableStoreOnlineBillingOnly,
          cin: meta.cin || "",
          tin: meta.tin || "",
          serviceTaxNumber: meta.serviceTaxNumber || "",
          gstNumber: meta.gstNumber || "",
          customerGstOrderPrefix: meta.customerGstOrderPrefix || "",
          fssaiLicenseNumber: meta.fssaiLicenseNumber || "",
          taxInformation: meta.taxInformation || "",
          customStoreOrderPrefix: meta.customStoreOrderPrefix || "",
          refundCustomStoreOrderPrefix: meta.refundCustomStoreOrderPrefix || "",
          ncCustomStoreOrderPrefix: meta.ncCustomStoreOrderPrefix || "",
          ncRefundCustomStoreOrderPrefix:
            meta.ncRefundCustomStoreOrderPrefix || "",
          rwiCustomStoreOrderPrefix: meta.rwiCustomStoreOrderPrefix || "",
        });
      } catch {
        if (mounted) setError("Failed to load store");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [params.id]);

  const onChange = (e) => {
    const value =
      e.target.name === "managerMobile"
        ? e.target.value.replace(/\D/g, "").slice(0, 10)
        : e.target.name === "pincode"
          ? e.target.value.replace(/\D/g, "").slice(0, 6)
          : ["storeAreaSqFt", "costPerSqFt"].includes(e.target.name)
            ? e.target.value.replace(/[^\d.]/g, "")
            : e.target.value;
    setForm((p) => ({ ...p, [e.target.name]: value }));
    setFieldErrors((p) => ({ ...p, [e.target.name]: "" }));
  };
  const onCheck = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.checked }));
  const onDocumentChange = async (key, file) => {
    if (!file) {
      setForm((p) => ({ ...p, documents: { ...p.documents, [key]: null } }));
      setFieldErrors((p) => ({ ...p, [`documents.${key}`]: "" }));
      return;
    }
    const fileName = file.name.toLowerCase();
    const isAllowedExtension = ALLOWED_DOCUMENT_EXTENSIONS.some((ext) =>
      fileName.endsWith(ext),
    );
    const isAllowedType = ALLOWED_DOCUMENT_TYPES.includes(file.type);
    if (!isAllowedExtension || !isAllowedType) {
      setFieldErrors((p) => ({
        ...p,
        [`documents.${key}`]: "Only JPG, PNG or PDF files are allowed",
      }));
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFieldErrors((p) => ({
        ...p,
        [`documents.${key}`]: "File must be 5 MB or smaller",
      }));
      return;
    }
    try {
      const doc = await fileToDocument(file);
      setForm((p) => ({ ...p, documents: { ...p.documents, [key]: doc } }));
      setFieldErrors((p) => ({ ...p, [`documents.${key}`]: "" }));
    } catch {
      setFieldErrors((p) => ({
        ...p,
        [`documents.${key}`]: "Unable to read selected file",
      }));
    }
  };
  const updateInteriorItem = (key, patch) => {
    setForm((current) => {
      const previous = current.interiorItems[key] || {};
      const next = { ...previous, ...patch };
      const amount = Number(next.amount || 0);
      const units = Number(next.units || 0);
      next.total = next.enabled && amount > 0 && units > 0 ? amount * units : 0;
      return {
        ...current,
        interiorItems: { ...current.interiorItems, [key]: next },
      };
    });
  };
  const inputClass = (field) =>
    `input ${fieldErrors[field] ? "input-error" : ""}`;
  const storeFormat = getStoreFormat(form.storeAreaSqFt);
  const totalAmount = getTotalAmount(form.storeAreaSqFt, form.costPerSqFt);
  const interiorGrandTotal = getInteriorGrandTotal(form.interiorItems);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const requiredFields = [
      ["name", "Store name is required"],
      ["locationType", "Location type is required"],
      ["addressLine1", "Address line 1 is required"],
      ["city", "City is required"],
      ["state", "State is required"],
      ["pincode", "Pincode is required"],
      ["country", "Country is required"],
      ["storeCode", "Store code is required"],
      ["managerName", "Franchise owner name is required"],
      ["managerMobile", "Mobile number is required"],
      ["gstNumber", "GST number is required"],
      ["franchiseType", "Select franchise type"],
    ];
    const missing = requiredFields.find(
      ([key]) => !String(form[key] || "").trim(),
    );
    if (missing) {
      setError(missing[1]);
      setFieldErrors({ [missing[0]]: missing[1] });
      return;
    }
    if (Number(form.storeAreaSqFt || 0) < 600) {
      setError("Store area must be at least 600 sq ft");
      setFieldErrors({
        storeAreaSqFt: "Store area must be at least 600 sq ft",
      });
      return;
    }
    if (Number(form.costPerSqFt || 0) < MIN_COST_PER_SQ_FT) {
      setError("Cost per sq ft cannot be less than Rs. 1400");
      setFieldErrors({
        costPerSqFt: "Cost per sq ft cannot be less than Rs. 1400",
      });
      return;
    }
    for (const field of DOCUMENT_FIELDS) {
      if (field.required && !form.documents[field.key]) {
        setError(`${field.label} is required`);
        setFieldErrors({
          [`documents.${field.key}`]: `${field.label} is required`,
        });
        return;
      }
    }
    if (!/^\d{6}$/.test(String(form.pincode || "").trim())) {
      setError("Pincode must be 6 digits");
      return;
    }
    if (!/^\d{10}$/.test(form.managerMobile)) {
      setError("Mobile number must be exactly 10 digits");
      setFieldErrors({ managerMobile: "Mobile number must be exactly 10 digits" });
      return;
    }
    if (
      form.managerEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.managerEmail.trim())
    ) {
      setError("Enter a valid e-mail address");
      return;
    }
    setSaving(true);

    try {
      const res = await fetch(`/api/stores/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Failed to update store");
        return;
      }

      setSuccess("Store updated successfully");
    } catch {
      setError("Failed to update store");
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
          <p className="text-sm text-gray-500">
            Update store details and save changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(`/settings/stores/${params.id}`)}
            className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50"
          >
            View
          </button>
          <button
            form="edit-store-form"
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <form id="edit-store-form" onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
            Basic Information
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Store Name *">
              <input
                name="name"
                value={form.name}
                onChange={onChange}
                required
                className="input"
              />
            </Field>
            <Field label="Location Type">
              <input
                name="locationType"
                value={form.locationType}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="Address Line 1 *">
              <input
                name="addressLine1"
                value={form.addressLine1}
                onChange={onChange}
                required
                className="input"
              />
            </Field>
            <Field label="Address Line 2">
              <input
                name="addressLine2"
                value={form.addressLine2}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="City *">
              <input
                name="city"
                value={form.city}
                onChange={onChange}
                required
                className="input"
              />
            </Field>
            <Field label="State *">
              <input
                name="state"
                value={form.state}
                onChange={onChange}
                required
                className="input"
              />
            </Field>
            <Field label="Pincode *">
              <input
                name="pincode"
                value={form.pincode}
                onChange={onChange}
                required
                maxLength={6}
                inputMode="numeric"
                className="input"
              />
            </Field>
            <Field label="Country *">
              <input
                name="country"
                value={form.country}
                onChange={onChange}
                required
                className="input"
              />
            </Field>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
            Store Information
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Franchise Owner Name *">
              <input
                name="managerName"
                value={form.managerName}
                onChange={onChange}
                className={inputClass("managerName")}
              />
            </Field>
            <Field label="Mobile Number *">
              <input
                name="managerMobile"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{10}"
                maxLength={10}
                value={form.managerMobile}
                onChange={onChange}
                className={inputClass("managerMobile")}
              />
            </Field>
            <Field label="E-mail Address">
              <input
                name="managerEmail"
                type="email"
                value={form.managerEmail}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="Opening Time">
              <input
                name="openingTime"
                value={form.openingTime}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="Closing Time">
              <input
                name="closingTime"
                value={form.closingTime}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="Store Code *">
              <input
                name="storeCode"
                value={form.storeCode}
                onChange={onChange}
                required
                className="input"
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Store Area (sq ft) *">
              <input
                name="storeAreaSqFt"
                inputMode="decimal"
                value={form.storeAreaSqFt}
                onChange={onChange}
                className={inputClass("storeAreaSqFt")}
              />
              {storeFormat ? (
                <span className="mt-1 block text-xs font-semibold text-blue-700">
                  {storeFormat}
                </span>
              ) : null}
            </Field>
            <Field label="Cost per sq ft *">
              <input
                name="costPerSqFt"
                inputMode="decimal"
                value={form.costPerSqFt}
                onChange={onChange}
                className={inputClass("costPerSqFt")}
              />
              {Number(form.costPerSqFt || 0) > 0 &&
              Number(form.costPerSqFt || 0) < MIN_COST_PER_SQ_FT ? (
                <span className="mt-1 block text-xs font-semibold text-red-600">
                  Can't be less than Rs.1400
                </span>
              ) : null}
            </Field>
            <Field label="Total Amount">
              <input
                value={totalAmount ? formatMoney(totalAmount) : ""}
                readOnly
                className="input bg-gray-50 font-semibold text-gray-900"
              />
            </Field>
            <Field label="Franchise Type *">
              <select
                name="franchiseType"
                value={form.franchiseType}
                onChange={onChange}
                className={inputClass("franchiseType")}
              >
                <option value="">Select franchise type</option>
                {FRANCHISE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4">
            <h4 className="mb-3 text-sm font-semibold text-gray-800">
              Franchise Documents
            </h4>
            <div className="grid gap-4 md:grid-cols-2">
              {DOCUMENT_FIELDS.map((field) => (
                <DocumentUpload
                  key={field.key}
                  field={field}
                  document={form.documents[field.key]}
                  error={fieldErrors[`documents.${field.key}`]}
                  onChange={(file) => onDocumentChange(field.key, file)}
                />
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-gray-800">Interior</h4>
              <span className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Grand Total: {formatMoney(interiorGrandTotal)}
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {INTERIOR_FIELDS.map((field) => (
                <InteriorLine
                  key={field.key}
                  field={field}
                  item={form.interiorItems[field.key]}
                  onChange={(patch) => updateInteriorItem(field.key, patch)}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <Toggle
              label="Enable Voucher Validation"
              name="enableVoucherValidation"
              checked={form.enableVoucherValidation}
              onChange={onCheck}
            />
            <Toggle
              label="Automatic Print"
              name="automaticPrint"
              checked={form.automaticPrint}
              onChange={onCheck}
            />
            <Toggle
              label="Enable Store Stock Alert"
              name="enableStoreStockAlert"
              checked={form.enableStoreStockAlert}
              onChange={onCheck}
            />
            <Toggle
              label="Enable Store Online Billing Only"
              name="enableStoreOnlineBillingOnly"
              checked={form.enableStoreOnlineBillingOnly}
              onChange={onCheck}
            />
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
            Receipt Settings
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="CIN">
              <input
                name="cin"
                value={form.cin}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="TIN">
              <input
                name="tin"
                value={form.tin}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="Service Tax Number">
              <input
                name="serviceTaxNumber"
                value={form.serviceTaxNumber}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="GST Number *">
              <input
                name="gstNumber"
                value={form.gstNumber}
                onChange={onChange}
                className={inputClass("gstNumber")}
              />
            </Field>
            <Field label="Customer GST Order Prefix">
              <input
                name="customerGstOrderPrefix"
                value={form.customerGstOrderPrefix}
                onChange={onChange}
                className="input"
              />
            </Field>
            <Field label="FSSAI License Number">
              <input
                name="fssaiLicenseNumber"
                value={form.fssaiLicenseNumber}
                onChange={onChange}
                className="input"
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Tax Information">
              <input
                name="taxInformation"
                value={form.taxInformation}
                onChange={onChange}
                className="input"
              />
            </Field>
          </div>
        </section>

        {(error || success) && (
          <p className={`text-sm ${error ? "text-red-600" : "text-green-600"}`}>
            {error || success}
          </p>
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
          border-color: #b00000;
          box-shadow: 0 0 0 1px #b00000;
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

function Field({ label, children }) {
  const isRequired = String(label || "")
    .trim()
    .endsWith("*");
  const displayLabel = isRequired ? String(label).replace(/\s*\*$/, "") : label;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {displayLabel}
        {isRequired ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function DocumentUpload({ field, document, error, onChange }) {
  const [showPreview, setShowPreview] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const documentType = String(document?.type || "").toLowerCase();
  const isPdf = documentType.includes("pdf");
  const isImage = documentType.startsWith("image/");

  return (
    <>
      <label
        className={`block rounded-lg border px-3 py-3 ${error ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}
      >
      <span className="mb-2 block text-sm font-medium text-gray-700">
        {field.label}
        {field.required ? (
          <span className="text-red-500"> *</span>
        ) : (
          <span className="text-gray-400"> (optional)</span>
        )}
      </span>
      <input
        key={inputKey}
        type="file"
        accept=".pdf,.jpg,.png"
        onChange={(e) => {
          setShowPreview(false);
          onChange(e.target.files?.[0] || null);
        }}
        className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
      />
      {document?.name ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="block truncate text-xs font-semibold text-green-700">
            {document.name}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowPreview((current) => !current);
            }}
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            {showPreview ? "Hide Preview" : "Show Preview"}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowPreview(false);
              setInputKey((current) => current + 1);
              onChange(null);
            }}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      ) : null}
      <span className="mt-2 block text-xs text-gray-500">
        Upload format: JPG/PNG/PDF. Max size: 5 MB.
      </span>
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-600">
          {error}
        </span>
      ) : null}
      </label>
      {showPreview && document?.dataUrl ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-gray-900">
                  {field.label} Preview
                </h3>
                <p className="truncate text-xs text-gray-500">
                  {document.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Hide Preview
              </button>
            </div>
            <div className="h-[70vh] bg-gray-50 p-3">
              {isImage ? (
                <img
                  src={document.dataUrl}
                  alt={`${field.label} preview`}
                  className="h-full w-full object-contain"
                />
              ) : isPdf ? (
                <iframe
                  src={document.dataUrl}
                  title={`${field.label} preview`}
                  className="h-full w-full rounded border border-gray-200 bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  Preview is not available for this file.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function InteriorLine({ field, item, onChange }) {
  const enabled = !!item?.enabled;
  const amount = item?.amount ?? "";
  const units = item?.units ?? "";
  const total = Number(item?.total || 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-800">
          {field.label}
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-4 w-4 accent-blue-600"
        />
      </label>
      {enabled ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Amount
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) =>
                onChange({ amount: e.target.value.replace(/[^\d.]/g, "") })
              }
              className="input"
              placeholder="0"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Units
            </span>
            <input
              inputMode="decimal"
              value={units}
              onChange={(e) =>
                onChange({ units: e.target.value.replace(/[^\d.]/g, "") })
              }
              className="input"
              placeholder="0"
            />
          </label>
          <div className="sm:col-span-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-bold text-gray-900">
            {formatMoney(total)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ label, name, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        name={name}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-blue-600"
      />
    </label>
  );
}
