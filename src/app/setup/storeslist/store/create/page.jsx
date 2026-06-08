"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
const PINCODE_CACHE_PREFIX = "store-pincode-location:v2:";

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

function locationFromPincodeOffice(office) {
  if (!office) return null;
  const city = String(
    office.Division || office.District || office.Region || office.Block || "",
  )
    .replace(/\s+Division$/i, "")
    .trim();
  return {
    city,
    state: office.State || "",
    country: office.Country || "India",
  };
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

export default function CreateStorePage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState({});
  const [savedStore, setSavedStore] = useState(null);
  const [pincodeStatus, setPincodeStatus] = useState("");

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
    if (errors[e.target.name]) {
      setErrors((p) => ({ ...p, [e.target.name]: "" }));
    }
  };
  const onCheck = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.checked }));
  const onDocumentChange = async (key, file) => {
    if (!file) {
      setForm((p) => ({ ...p, documents: { ...p.documents, [key]: null } }));
      setErrors((p) => ({ ...p, [`documents.${key}`]: "" }));
      return;
    }
    const fileName = file.name.toLowerCase();
    const isAllowedExtension = ALLOWED_DOCUMENT_EXTENSIONS.some((ext) =>
      fileName.endsWith(ext),
    );
    const isAllowedType = ALLOWED_DOCUMENT_TYPES.includes(file.type);
    if (!isAllowedExtension || !isAllowedType) {
      setErrors((p) => ({
        ...p,
        [`documents.${key}`]: "Only JPG, PNG or PDF files are allowed",
      }));
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setErrors((p) => ({
        ...p,
        [`documents.${key}`]: "File must be 5 MB or smaller",
      }));
      return;
    }
    try {
      const doc = await fileToDocument(file);
      setForm((p) => ({ ...p, documents: { ...p.documents, [key]: doc } }));
      setErrors((p) => ({ ...p, [`documents.${key}`]: "" }));
    } catch {
      setErrors((p) => ({
        ...p,
        [`documents.${key}`]: "Unable to read selected file",
      }));
    }
  };

  useEffect(() => {
    const pincode = form.pincode.trim();
    if (pincode.length !== 6) {
      setPincodeStatus("");
      return;
    }

    const applyLocation = (location) => {
      if (!location) return false;
      setForm((current) => ({
        ...current,
        city: location.city || current.city,
        state: location.state || current.state,
        country: location.country || "India",
      }));
      setErrors((current) => ({
        ...current,
        city: "",
        state: "",
        country: "",
        pincode: "",
      }));
      setPincodeStatus("Location filled from pincode");
      return true;
    };

    const cacheKey = `${PINCODE_CACHE_PREFIX}${pincode}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached && applyLocation(JSON.parse(cached))) {
        return;
      }
    } catch {
      // Ignore cache read errors.
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let cancelled = false;
    setPincodeStatus("Fetching location...");

    fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const result = Array.isArray(data) ? data[0] : null;
        const office = result?.PostOffice?.[0];
        if (result?.Status !== "Success" || !office) {
          setPincodeStatus("No location found for this pincode");
          return;
        }
        const location = locationFromPincodeOffice(office);
        applyLocation(location);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(location));
        } catch {
          // Ignore cache write errors.
        }
      })
      .catch(() => {
        if (!cancelled) setPincodeStatus("Unable to fetch location");
      })
      .finally(() => {
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [form.pincode]);

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

  const inputClass = (field) => `input ${errors[field] ? "input-error" : ""}`;
  const storeFormat = getStoreFormat(form.storeAreaSqFt);
  const totalAmount = getTotalAmount(form.storeAreaSqFt, form.costPerSqFt);
  const interiorGrandTotal = getInteriorGrandTotal(form.interiorItems);

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = "Store name is required";
    if (!form.locationType) next.locationType = "Location type is required";
    if (!form.addressLine1.trim())
      next.addressLine1 = "Address line 1 is required";
    if (!form.city.trim()) next.city = "City is required";
    if (!form.state.trim()) next.state = "State is required";
    if (!form.pincode.trim()) next.pincode = "Pincode is required";
    else if (!/^\d{6}$/.test(form.pincode.trim()))
      next.pincode = "Pincode must be 6 digits";
    if (!form.country.trim()) next.country = "Country is required";
    if (!form.storeCode.trim()) next.storeCode = "Store code is required";
    if (!form.managerName.trim())
      next.managerName = "Franchise owner name is required";
    if (!form.managerMobile.trim())
      next.managerMobile = "Mobile number is required";
    else if (!/^\d{10}$/.test(form.managerMobile))
      next.managerMobile = "Mobile number must be exactly 10 digits";
    if (!form.gstNumber.trim()) next.gstNumber = "GST number is required";
    if (!form.storeAreaSqFt || Number(form.storeAreaSqFt) < 600)
      next.storeAreaSqFt = "Store area must be at least 600 sq ft";
    if (!form.costPerSqFt || Number(form.costPerSqFt) < MIN_COST_PER_SQ_FT)
      next.costPerSqFt = "Cost per sq ft cannot be less than Rs. 1400";
    if (!FRANCHISE_TYPES.includes(form.franchiseType))
      next.franchiseType = "Select franchise type";
    for (const field of DOCUMENT_FIELDS) {
      if (field.required && !form.documents[field.key]) {
        next[`documents.${field.key}`] = `${field.label} is required`;
      }
    }
    if (
      form.managerEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.managerEmail.trim())
    ) {
      next.managerEmail = "Enter a valid e-mail address";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validate()) {
      setError("Please fix the highlighted fields");
      return;
    }
    setSavedStore({
      name: form.name,
      address_line1: form.addressLine1,
      address_line2: form.addressLine2,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
      country: form.country,
      manager_name: form.managerName,
      manager_mobile: form.managerMobile,
      manager_email: form.managerEmail,
      opening_time: form.openingTime,
      closing_time: form.closingTime,
      is_active: true,
      meta: {
        ...form,
        shortCode: form.storeCode,
        storeFormat,
        totalStoreAmount: totalAmount,
        interiorGrandTotal,
      },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFinalSave = async () => {
    setError("");
    setLoading(true);
    try {
      const payload = {
        ...form,
        documents: Object.fromEntries(
          Object.entries(form.documents || {}).map(([key, document]) => [
            key,
            document
              ? {
                  name: document.name,
                  type: document.type,
                  size: document.size,
                }
              : null,
          ]),
        ),
      };
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (!res.ok || !json.success) {
        setError(
          res.status === 413
            ? "Uploaded documents are too large. Please reduce file size and try again."
            : json.message || "Failed to create store",
        );
        return;
      }
      router.push("/settings/stores");
    } catch (err) {
      setError(err.message || "Failed to create store");
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Create Store</h2>
          <p className="text-sm text-gray-500">
            Add store address, contact and billing settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/settings/stores")}
            className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50"
          >
            Back
          </button>
          {!savedStore && (
            <button
              form="create-store-form"
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Preview
            </button>
          )}
          {savedStore && (
            <>
              <button
                type="button"
                onClick={() => setSavedStore(null)}
                disabled={loading}
                className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50 disabled:opacity-60"
              >
                Edit Details
              </button>
              <button
                type="button"
                onClick={handleFinalSave}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? "Saving..." : "Save Store"}
              </button>
            </>
          )}
        </div>
      </div>

      {savedStore ? (
        <div className="space-y-5">
          <section className="bg-white border border-green-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[15px] font-semibold text-green-700">
                  Review store details
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Please verify all details. The store will be created only after clicking Save Store.
                </p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <div>
                  Store Code:{" "}
                  {savedStore.meta?.storeCode ||
                    savedStore.meta?.shortCode ||
                    form.storeCode ||
                    "—"}
                </div>
                <div>
                  Status: {savedStore.is_active ? "Active" : "Inactive"}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Basic Information
            </h3>
            <DetailGrid
              items={[
                ["Store Name", savedStore.name],
                [
                  "Location Type",
                  savedStore.meta?.locationType || form.locationType,
                ],
                [
                  "Address Line 1",
                  savedStore.address_line1 || form.addressLine1,
                ],
                [
                  "Address Line 2",
                  savedStore.address_line2 || form.addressLine2,
                ],
                ["City", savedStore.city || form.city],
                ["State", savedStore.state || form.state],
                ["Pincode", savedStore.pincode || form.pincode],
                ["Country", savedStore.country || form.country],
                ["Pan Number", savedStore.meta?.panNumber || form.panNumber],
              ]}
            />
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Store Information
            </h3>
            <DetailGrid
              items={[
                ["Manager Name", savedStore.manager_name || form.managerName],
                [
                  "Mobile Number",
                  savedStore.manager_mobile || form.managerMobile,
                ],
                [
                  "E-mail Address",
                  savedStore.manager_email || form.managerEmail,
                ],
                ["Opening Time", savedStore.opening_time || form.openingTime],
                ["Closing Time", savedStore.closing_time || form.closingTime],
                [
                  "Store Code",
                  savedStore.meta?.storeCode ||
                    savedStore.meta?.shortCode ||
                    form.storeCode,
                ],
                [
                  "Store Area",
                  `${savedStore.meta?.storeAreaSqFt || form.storeAreaSqFt} sq ft`,
                ],
                [
                  "Store Format",
                  savedStore.meta?.storeFormat ||
                    getStoreFormat(form.storeAreaSqFt),
                ],
                [
                  "Cost per sq ft",
                  formatMoney(savedStore.meta?.costPerSqFt || form.costPerSqFt),
                ],
                [
                  "Total Amount",
                  formatMoney(savedStore.meta?.totalStoreAmount || totalAmount),
                ],
                [
                  "Franchise Type",
                  savedStore.meta?.franchiseType || form.franchiseType,
                ],
                [
                  "Interior Grand Total",
                  formatMoney(
                    savedStore.meta?.interiorGrandTotal || interiorGrandTotal,
                  ),
                ],
                [
                  "Voucher Validation",
                  (savedStore.meta?.enableVoucherValidation ??
                  form.enableVoucherValidation)
                    ? "Yes"
                    : "No",
                ],
                [
                  "Automatic Print",
                  (savedStore.meta?.automaticPrint ?? form.automaticPrint)
                    ? "Yes"
                    : "No",
                ],
                [
                  "Stock Alert",
                  (savedStore.meta?.enableStoreStockAlert ??
                  form.enableStoreStockAlert)
                    ? "Yes"
                    : "No",
                ],
                [
                  "Online Billing Only",
                  (savedStore.meta?.enableStoreOnlineBillingOnly ??
                  form.enableStoreOnlineBillingOnly)
                    ? "Yes"
                    : "No",
                ],
              ]}
            />
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Receipt Settings
            </h3>
            <DetailGrid
              items={[
                ["CIN", savedStore.meta?.cin || form.cin],
                ["TIN", savedStore.meta?.tin || form.tin],
                [
                  "Service Tax Number",
                  savedStore.meta?.serviceTaxNumber || form.serviceTaxNumber,
                ],
                ["GST Number", savedStore.meta?.gstNumber || form.gstNumber],
                [
                  "Customer GST Order Prefix",
                  savedStore.meta?.customerGstOrderPrefix ||
                    form.customerGstOrderPrefix,
                ],
                [
                  "FSSAI License Number",
                  savedStore.meta?.fssaiLicenseNumber ||
                    form.fssaiLicenseNumber,
                ],
                [
                  "Tax Information",
                  savedStore.meta?.taxInformation || form.taxInformation,
                ],
              ]}
            />
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Custom Order Prefix
            </h3>
            <DetailGrid
              items={[
                [
                  "Custom Store Order Prefix",
                  savedStore.meta?.customStoreOrderPrefix ||
                    form.customStoreOrderPrefix,
                ],
                [
                  "Refund Custom Store Order Prefix",
                  savedStore.meta?.refundCustomStoreOrderPrefix ||
                    form.refundCustomStoreOrderPrefix,
                ],
                [
                  "NC Custom Store Order Prefix",
                  savedStore.meta?.ncCustomStoreOrderPrefix ||
                    form.ncCustomStoreOrderPrefix,
                ],
                [
                  "NC Refund Custom Store Order Prefix",
                  savedStore.meta?.ncRefundCustomStoreOrderPrefix ||
                    form.ncRefundCustomStoreOrderPrefix,
                ],
                [
                  "RWI Custom Store Order Prefix",
                  savedStore.meta?.rwiCustomStoreOrderPrefix ||
                    form.rwiCustomStoreOrderPrefix,
                ],
              ]}
            />
          </section>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSavedStore(null)}
              disabled={loading}
              className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              Edit Details
            </button>
            <button
              type="button"
              onClick={handleFinalSave}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save Store"}
            </button>
          </div>
        </div>
      ) : (
        <form
          id="create-store-form"
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Basic Information
            </h3>
            <div className="space-y-4">
              <Field label="Store Name *" error={errors.name}>
                <input
                  name="name"
                  value={form.name}
                  onChange={onChange}
                  className={inputClass("name")}
                  placeholder="Noida Store"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Location Type *" error={errors.locationType}>
                  <select
                    name="locationType"
                    value={form.locationType}
                    onChange={onChange}
                    className={inputClass("locationType")}
                  >
                    <option value="Store">Store</option>
                    <option value="Warehouse">Warehouse</option>
                    <option value="Outlet">Outlet</option>
                  </select>
                </Field>
                <Field label="State *" error={errors.state}>
                  <input
                    name="state"
                    value={form.state}
                    onChange={onChange}
                    className={inputClass("state")}
                    placeholder="Uttar Pradesh"
                  />
                </Field>
              </div>

              <Field label="Address Line 1 *" error={errors.addressLine1}>
                <input
                  name="addressLine1"
                  value={form.addressLine1}
                  onChange={onChange}
                  className={inputClass("addressLine1")}
                  placeholder="6th floor, C55, Priska Tower"
                />
              </Field>

              <Field label="Address Line 2">
                <input
                  name="addressLine2"
                  value={form.addressLine2}
                  onChange={onChange}
                  className="input"
                  placeholder="Sector - 62, Noida"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="City *" error={errors.city}>
                  <input
                    name="city"
                    value={form.city}
                    onChange={onChange}
                    className={inputClass("city")}
                    placeholder="Noida"
                  />
                </Field>
                <Field label="Pincode *" error={errors.pincode}>
                  <input
                    name="pincode"
                    value={form.pincode}
                    onChange={onChange}
                    className={inputClass("pincode")}
                    placeholder="201309"
                    inputMode="numeric"
                    maxLength={6}
                  />
                  {pincodeStatus ? (
                    <span className="mt-1 block text-xs font-medium text-gray-500">
                      {pincodeStatus}
                    </span>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Country *" error={errors.country}>
                  <input
                    name="country"
                    value={form.country}
                    onChange={onChange}
                    className={inputClass("country")}
                  />
                </Field>
                <Field label="Pan Number">
                  <input
                    name="panNumber"
                    value={form.panNumber}
                    onChange={onChange}
                    className="input"
                    placeholder="ABCDE1234F"
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Store Contact & Operations
            </h3>
            <div className="space-y-4">
              <Field label="Franchise Owner Name *" error={errors.managerName}>
                <input
                  name="managerName"
                  value={form.managerName}
                  onChange={onChange}
                  className={inputClass("managerName")}
                  placeholder="Enter Name"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Contact Mobile *" error={errors.managerMobile}>
                  <input
                    name="managerMobile"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={form.managerMobile}
                    onChange={onChange}
                    className={inputClass("managerMobile")}
                    placeholder="9958160899"
                  />
                </Field>
                <Field label="Contact E-mail" error={errors.managerEmail}>
                  <input
                    name="managerEmail"
                    type="email"
                    value={form.managerEmail}
                    onChange={onChange}
                    className={inputClass("managerEmail")}
                    placeholder="Enter email"
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Opening Time">
                  <input
                    name="openingTime"
                    value={form.openingTime}
                    onChange={onChange}
                    className="input"
                    placeholder="10:00 am"
                  />
                </Field>
                <Field label="Closing Time">
                  <input
                    name="closingTime"
                    value={form.closingTime}
                    onChange={onChange}
                    className="input"
                    placeholder="10:00 pm"
                  />
                </Field>
              </div>

              <Field label="Store Code *" error={errors.storeCode}>
                <input
                  name="storeCode"
                  value={form.storeCode}
                  onChange={onChange}
                  className={inputClass("storeCode")}
                  placeholder="e.g. Noida-01"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Store Area (sq ft) *"
                  error={errors.storeAreaSqFt}
                >
                  <input
                    name="storeAreaSqFt"
                    inputMode="decimal"
                    value={form.storeAreaSqFt}
                    onChange={onChange}
                    className={inputClass("storeAreaSqFt")}
                    placeholder="600"
                  />
                  {storeFormat ? (
                    <span className="mt-1 block text-xs font-semibold text-blue-700">
                      {storeFormat}
                    </span>
                  ) : null}
                </Field>
                <Field label="Cost per sq ft *" error={errors.costPerSqFt}>
                  <input
                    name="costPerSqFt"
                    inputMode="decimal"
                    value={form.costPerSqFt}
                    onChange={onChange}
                    className={inputClass("costPerSqFt")}
                    placeholder="1400"
                  />
                  {Number(form.costPerSqFt || 0) > 0 &&
                  Number(form.costPerSqFt || 0) < MIN_COST_PER_SQ_FT ? (
                    <span className="mt-1 block text-xs font-semibold text-red-600">
                      Can't be less than Rs.1400
                    </span>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Total Amount">
                  <input
                    value={totalAmount ? formatMoney(totalAmount) : ""}
                    readOnly
                    className="input bg-gray-50 font-semibold text-gray-900"
                    placeholder="Auto calculated"
                  />
                </Field>
                <Field label="Franchise Type *" error={errors.franchiseType}>
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

              <div>
                <h4 className="mb-3 text-sm font-semibold text-gray-800">
                  Franchise Documents
                </h4>
                <div className="grid gap-4 md:grid-cols-2">
                  {DOCUMENT_FIELDS.map((field) => (
                    <DocumentUpload
                      key={field.key}
                      field={field}
                      document={form.documents[field.key]}
                      error={errors[`documents.${field.key}`]}
                      onChange={(file) => onDocumentChange(field.key, file)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-gray-800">
                    Interior
                  </h4>
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

              <div className="grid gap-4 md:grid-cols-2">
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Receipt Settings
            </h3>
            <div className="space-y-4">
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Service Tax Number">
                  <input
                    name="serviceTaxNumber"
                    value={form.serviceTaxNumber}
                    onChange={onChange}
                    className="input"
                  />
                </Field>
                <Field label="GST Number *" error={errors.gstNumber}>
                  <input
                    name="gstNumber"
                    value={form.gstNumber}
                    onChange={onChange}
                    className={inputClass("gstNumber")}
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-[15px] font-semibold text-blue-700 mb-4">
              Custom Order Prefix
            </h3>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Custom Store Order Prefix">
                  <input
                    name="customStoreOrderPrefix"
                    value={form.customStoreOrderPrefix}
                    onChange={onChange}
                    className="input"
                  />
                </Field>
                <Field label="Refund Custom Store Order Prefix">
                  <input
                    name="refundCustomStoreOrderPrefix"
                    value={form.refundCustomStoreOrderPrefix}
                    onChange={onChange}
                    className="input"
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="NC Custom Store Order Prefix">
                  <input
                    name="ncCustomStoreOrderPrefix"
                    value={form.ncCustomStoreOrderPrefix}
                    onChange={onChange}
                    className="input"
                  />
                </Field>
                <Field label="NC Refund Custom Store Order Prefix">
                  <input
                    name="ncRefundCustomStoreOrderPrefix"
                    value={form.ncRefundCustomStoreOrderPrefix}
                    onChange={onChange}
                    className="input"
                  />
                </Field>
              </div>

              <Field label="RWI Custom Store Order Prefix">
                <input
                  name="rwiCustomStoreOrderPrefix"
                  value={form.rwiCustomStoreOrderPrefix}
                  onChange={onChange}
                  className="input"
                />
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

function Field({ label, children, error }) {
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
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-600">
          {error}
        </span>
      ) : null}
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

function DetailGrid({ items }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs font-medium text-gray-500">{label}</div>
          <div className="mt-1 text-sm font-semibold text-gray-900">
            {value || "-"}
          </div>
        </div>
      ))}
    </div>
  );
}
