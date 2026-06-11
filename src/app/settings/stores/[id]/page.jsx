"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import MainLayout from "@/components/MainLayout";

function InfoGrid({ items }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="text-[12px] font-medium text-gray-500">{label}</div>
          <div className="mt-1 text-sm font-semibold text-gray-900 break-words">
            {value || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function documentName(doc) {
  return doc?.name || "";
}

const DOCUMENT_FIELDS = [
  { key: "agreement", label: "Agreement" },
  { key: "aadhaar", label: "Aadhaar" },
  { key: "panCard", label: "PAN Card" },
  { key: "rentAgreement", label: "Electricity Bill / Rent Agreement" },
];

const INTERIOR_LABELS = {
  ac: "AC",
  refrigerator: "Refrigerator",
  deepFreezer: "Deep Freezer",
  racks: "Racks",
  sealingMachine: "Sealing Machine",
  weighingMachine: "Weighing Machine",
  palletBoard: "Pallet Board",
  bloombellBundle: "Bloombell Bundle",
  bumbWell: "Bumb Well",
  fireExtinguisher: "Fire Extinguisher",
  ledBoard: "LED Board",
  posMachine: "POS Machine",
  billingThermalPrinterScanner: "Billing Thermal Printer Scanner",
  billingCounter: "Billing Counter",
  shoppingBasket: "Shopping Basket",
  cart: "Cart",
};

function interiorItemsForDisplay(items = {}) {
  return Object.entries(INTERIOR_LABELS)
    .filter(([key]) => items?.[key]?.enabled)
    .map(([key, label]) => {
      const item = items[key] || {};
      return [
        label,
        `${Number(item.units || 0)} x ${formatMoney(item.amount || 0)} = ${formatMoney(item.total || 0)}`,
      ];
    });
}

export default function StoreDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewDocument, setPreviewDocument] = useState(null);
  const [previewLabel, setPreviewLabel] = useState("");
  const [previewLoadingKey, setPreviewLoadingKey] = useState("");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/stores/${params.id}`);
        const json = await res.json();
        if (!mounted) return;
        if (res.ok && json.success) {
          setStore(json.data.store);
        } else {
          setError(json.message || "Unable to load store");
        }
      } catch (e) {
        if (mounted) setError("Network error");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [params.id]);

  const openDocumentPreview = async (field) => {
    setPreviewError("");
    setPreviewLoadingKey(field.key);
    try {
      const res = await fetch(`/api/stores/${params.id}/documents/${field.key}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.data?.document?.dataUrl) {
        throw new Error(json.message || "Preview is not available");
      }
      setPreviewDocument(json.data.document);
      setPreviewLabel(field.label);
    } catch (err) {
      setPreviewError(err.message || "Preview is not available");
    } finally {
      setPreviewLoadingKey("");
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">
            <Link
              href="/settings/stores"
              className="text-blue-600 hover:underline"
            >
              Settings
            </Link>{" "}
            <span className="mx-1">/</span> Store Details
          </div>
          <h1 className="text-xl font-bold text-gray-900">Store Details</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/settings/stores/${params.id}/edit`)}
            className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            onClick={() => router.push("/settings/stores")}
            className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : store ? (
        <div className="space-y-5">
          <section className="rounded-xl border border-green-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-green-700">
                  {store.name}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Created on{" "}
                  {new Date(store.created_at).toLocaleString("en-IN")}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${store.is_active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}
              >
                {store.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="mb-4 text-[15px] font-semibold text-blue-700">
              Basic Information
            </h3>
            <InfoGrid
              items={[
                ["Store Code", store.meta?.storeCode || store.meta?.shortCode],
                ["Store Name", store.name],
                ["Address Line 1", store.address_line1],
                ["Address Line 2", store.address_line2],
                ["City", store.city],
                ["State", store.state],
                ["Pincode", store.pincode],
                ["Country", store.country],
                ["Location Type", store.meta?.locationType],
                ["Pan Number", store.meta?.panNumber],
              ]}
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="mb-4 text-[15px] font-semibold text-blue-700">
              Store Information
            </h3>
            <InfoGrid
              items={[
                ["Franchise Owner Name", store.manager_name],
                ["Mobile Number", store.manager_mobile],
                ["E-mail Address", store.manager_email],
                ["Opening Time", store.opening_time],
                ["Closing Time", store.closing_time],
                ["Users", store.meta?.users],
                ["Store Capacity", store.meta?.storeCapacity],
                [
                  "Store Area",
                  store.meta?.storeAreaSqFt
                    ? `${store.meta.storeAreaSqFt} sq ft`
                    : store.meta?.storeArea,
                ],
                ["Store Format", store.meta?.storeFormat],
                [
                  "Cost per sq ft",
                  store.meta?.costPerSqFt
                    ? formatMoney(store.meta.costPerSqFt)
                    : "",
                ],
                [
                  "Total Amount",
                  store.meta?.totalStoreAmount
                    ? formatMoney(store.meta.totalStoreAmount)
                    : "",
                ],
                ["Franchise Type", store.meta?.franchiseType],
                [
                  "Interior Grand Total",
                  store.meta?.interiorGrandTotal
                    ? formatMoney(store.meta.interiorGrandTotal)
                    : "",
                ],
                [
                  "Voucher Validation",
                  store.meta?.enableVoucherValidation ? "Yes" : "No",
                ],
                ["Automatic Print", store.meta?.automaticPrint ? "Yes" : "No"],
                [
                  "Store Stock Alert",
                  store.meta?.enableStoreStockAlert ? "Yes" : "No",
                ],
                [
                  "Online Billing Only",
                  store.meta?.enableStoreOnlineBillingOnly ? "Yes" : "No",
                ],
              ]}
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="mb-4 text-[15px] font-semibold text-blue-700">
              Franchise Documents
            </h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {DOCUMENT_FIELDS.map((field) => {
                const document = store.meta?.documents?.[field.key];
                const name = documentName(document);
                return (
                  <div
                    key={field.key}
                    className="rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="text-[12px] font-medium text-gray-500">
                      {field.label}
                    </div>
                    <div className="mt-1 min-h-[1.25rem] break-words text-sm font-semibold text-gray-900">
                      {name || "-"}
                    </div>
                    {name ? (
                      <button
                        type="button"
                        onClick={() => openDocumentPreview(field)}
                        disabled={previewLoadingKey === field.key}
                        className="mt-3 text-xs font-semibold text-blue-700 hover:underline disabled:text-gray-400"
                      >
                        {previewLoadingKey === field.key
                          ? "Loading Preview..."
                          : "Show Preview"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {previewError ? (
              <p className="mt-3 text-sm font-medium text-red-600">
                {previewError}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-blue-700">
                Interior
              </h3>
              <span className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Grand Total: {formatMoney(store.meta?.interiorGrandTotal || 0)}
              </span>
            </div>
            <InfoGrid
              items={
                interiorItemsForDisplay(store.meta?.interiorItems).length
                  ? interiorItemsForDisplay(store.meta?.interiorItems)
                  : [["Selected Items", "No interior items selected"]]
              }
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="mb-4 text-[15px] font-semibold text-blue-700">
              Receipt Settings
            </h3>
            <InfoGrid
              items={[
                ["CIN", store.meta?.cin],
                ["TIN", store.meta?.tin],
                ["Service Tax Number", store.meta?.serviceTaxNumber],
                ["GST Number", store.meta?.gstNumber],
                [
                  "Customer GST Order Prefix",
                  store.meta?.customerGstOrderPrefix,
                ],
                ["FSSAI License Number", store.meta?.fssaiLicenseNumber],
                ["Tax Information", store.meta?.taxInformation],
              ]}
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="mb-4 text-[15px] font-semibold text-blue-700">
              Custom Order Prefix
            </h3>
            <InfoGrid
              items={[
                [
                  "Custom Store Order Prefix",
                  store.meta?.customStoreOrderPrefix,
                ],
                [
                  "Refund Custom Store Order Prefix",
                  store.meta?.refundCustomStoreOrderPrefix,
                ],
                [
                  "NC Custom Store Order Prefix",
                  store.meta?.ncCustomStoreOrderPrefix,
                ],
                [
                  "NC Refund Custom Store Order Prefix",
                  store.meta?.ncRefundCustomStoreOrderPrefix,
                ],
                [
                  "RWI Custom Store Order Prefix",
                  store.meta?.rwiCustomStoreOrderPrefix,
                ],
              ]}
            />
          </section>
        </div>
      ) : null}
      {previewDocument?.dataUrl ? (
        <DocumentPreviewModal
          label={previewLabel}
          document={previewDocument}
          onClose={() => {
            setPreviewDocument(null);
            setPreviewLabel("");
          }}
        />
      ) : null}
    </MainLayout>
  );
}

function DocumentPreviewModal({ label, document, onClose }) {
  const documentType = String(document?.type || "").toLowerCase();
  const isPdf = documentType.includes("pdf");
  const isImage = documentType.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-gray-900">
              {label} Preview
            </h3>
            <p className="truncate text-xs text-gray-500">{document.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Hide Preview
          </button>
        </div>
        <div className="h-[70vh] bg-gray-50 p-3">
          {isImage ? (
            <img
              src={document.dataUrl}
              alt={`${label} preview`}
              className="h-full w-full object-contain"
            />
          ) : isPdf ? (
            <iframe
              src={document.dataUrl}
              title={`${label} preview`}
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
  );
}
