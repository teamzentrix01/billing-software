"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateQRDataURL, getInvoiceURL } from "@/lib/qrService";
import { validatePhoneNumber } from "@/lib/phoneValidator";
import { useRouter } from "next/navigation";
import MainLayout from "@/components/MainLayout";
import { fetchAuthEndpoint } from "@/lib/auth-endpoints";

// ============================================================================
// UTILITIES
// ============================================================================

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUnit(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getWeightedUnitKind(unit) {
  const normalized = normalizeUnit(unit).replace(/[\s_-]+/g, "");
  if (!normalized) return null;
  if (
    ["G", "GM", "GMS", "GRAM", "GRAMS", "GRM", "GRMS"].includes(normalized) ||
    normalized.includes("GRAM")
  ) {
    return "GRAMS";
  }
  if (
    ["KG", "KGS", "KILOGRAM", "KILOGRAMS", "KILO", "KILOS"].includes(
      normalized,
    ) ||
    normalized.includes("KG") ||
    normalized.includes("KILO")
  ) {
    return "KG";
  }
  return null;
}

function isWeightedUnit(unit) {
  return Boolean(getWeightedUnitKind(unit));
}

function getScaleQuantityForUnit(weightKg, weightedUnit) {
  const normalizedWeight = Number(Number(weightKg || 0).toFixed(3));
  if (normalizedWeight <= 0) return 0;
  return weightedUnit === "GRAMS"
    ? Number((normalizedWeight * 1000).toFixed(3))
    : normalizedWeight;
}

function formatScaleWeight(weightKg) {
  const normalizedWeight = Number(Number(weightKg || 0).toFixed(3));
  if (normalizedWeight < 1) {
    return `${Math.round(normalizedWeight * 1000)} g`;
  }
  return `${normalizedWeight.toFixed(3)} KG`;
}

const EAGLE_SCALE_SERIAL_OPTIONS = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

function parseScaleWeight(rawValue) {
  const text = String(rawValue || "")
    .replace(/,/g, ".")
    .trim();
  if (!text) return null;
  const signedMatches = [
    ...text.matchAll(
      /([+-]\s*\d{1,6}(?:\.\d{1,3})?)\s*(kg|kgs|g|gm|gram|grams)?/gi,
    ),
  ];
  const unitMatches = [
    ...text.matchAll(
      /(?:^|[^\d.])(\d{1,6}(?:\.\d{1,3})?)\s*(kg|kgs|g|gm|gram|grams)\b/gi,
    ),
  ];
  const matches = [...signedMatches, ...unitMatches].sort(
    (a, b) => a.index - b.index,
  );
  const match = matches[matches.length - 1];
  if (!match) return null;
  const value = Number(String(match[1]).replace(/\s+/g, ""));
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  const unit = String(match[2] || "kg").toLowerCase();
  return ["g", "gm", "gram", "grams"].includes(unit) ? value / 1000 : value;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatReceiptDateTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

const SESSION_CLOSE_CUTOFF_HOUR = 21;
const SESSION_TIME_ZONE = "Asia/Kolkata";

function getCurrentHourInTimeZone(timeZone = SESSION_TIME_ZONE) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
}

function canClosePosSessionNow() {
  return getCurrentHourInTimeZone() >= SESSION_CLOSE_CUTOFF_HOUR;
}

function generateInvoiceNumber() {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function emptyPayment() {
  return { method: "cash", amount: "", referenceNo: "" };
}

function getReceiptPayments(receipt) {
  const bill = receipt?.bill || receipt || {};
  const direct = Array.isArray(bill.payments)
    ? bill.payments
    : Array.isArray(receipt?.payments)
      ? receipt.payments
      : [];
  if (direct.length) return direct;
  if (Array.isArray(bill.payment_meta)) return bill.payment_meta;
  if (Array.isArray(bill.paymentMeta)) return bill.paymentMeta;
  return [];
}

function formatPaymentMethod(method) {
  const value = String(method || "cash").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Cash";
}

function formatPaymentBreakup(payments, fallbackMode = "cash") {
  const rows = (Array.isArray(payments) ? payments : [])
    .map((payment) => ({
      method:
        payment.method || payment.payment_mode || payment.mode || fallbackMode,
      amount: toNumber(payment.amount),
    }))
    .filter((payment) => payment.amount > 0);

  if (!rows.length) return formatPaymentMethod(fallbackMode);
  if (rows.length === 1)
    return `${formatPaymentMethod(rows[0].method)} ${formatCurrency(rows[0].amount)}`;
  return `Split: ${rows.map((payment) => `${formatPaymentMethod(payment.method)} ${formatCurrency(payment.amount)}`).join(" + ")}`;
}

const DEFAULT_PAYMENT_OPTIONS = [
  { value: "cash", label: "Cash", icon: "ti-cash" },
  { value: "card", label: "Card", icon: "ti-credit-card" },
  { value: "upi", label: "UPI", icon: "ti-qrcode" },
  { value: "credit", label: "Credit", icon: "ti-file-invoice" },
];

const FIXED_PAYMENT_METHODS = DEFAULT_PAYMENT_OPTIONS.map((option) => ({
  method: option.value,
  label: option.label,
  icon: option.icon,
}));

const PAYMENT_ICON_BY_CODE = {
  cash: "ti-cash",
  card: "ti-credit-card",
  upi: "ti-qrcode",
  credit: "ti-file-invoice",
  wallet: "ti-wallet",
};

const STANDARD_PAYMENT_LABELS = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "Credit",
  wallet: "Wallet",
  split: "Split",
};

function getPaymentLabel(code, fallback = "") {
  const normalized = String(code || "")
    .trim()
    .toLowerCase();
  return (
    STANDARD_PAYMENT_LABELS[normalized] ||
    fallback ||
    normalized.charAt(0).toUpperCase() + normalized.slice(1)
  );
}

function normalizePaymentOptions(modes = []) {
  const mapped = (Array.isArray(modes) ? modes : [])
    .map((mode) => {
      const value = String(
        mode.code || mode.value || mode.paymentMode || mode.name || "",
      )
        .trim()
        .toLowerCase();
      if (!value) return null;
      const label = getPaymentLabel(value, mode.name || mode.label);
      return {
        value,
        label,
        icon: PAYMENT_ICON_BY_CODE[value] || "ti-credit-card",
      };
    })
    .filter(Boolean);

  const byValue = new Map(
    DEFAULT_PAYMENT_OPTIONS.map((option) => [option.value, option]),
  );
  for (const option of mapped) {
    byValue.set(option.value, option);
  }

  return Array.from(byValue.values());
}

const inputClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-400 outline-none";
const DEFAULT_RECEIPT_CONFIG = {
  businessName: "Buyzaar Sync",
  subtitle: "GST Invoice / POS Receipt",
  headerText: "",
  footerText: "Thank you. Visit again.",
  template: "thermal-80",
  copies: 1,
  showTaxBreakup: true,
  showDiscount: true,
  showQr: true,
  showCustomerMobile: true,
  showSku: true,
};

function normalizeProduct(p) {
  const selectedBatchId = p.selectedBatchId ?? p.selected_batch_id ?? null;
  const selectedBatchIds = Array.isArray(p.selectedBatchIds)
    ? p.selectedBatchIds
    : Array.isArray(p.selected_batch_ids)
      ? p.selected_batch_ids
      : [];
  const sellingPrice = toNumber(p.selling_price || p.sellingPrice || p.mrp);
  const mrp = toNumber(p.mrp || p.selling_price || p.sellingPrice);
  const variantKey = String(
    p.variantKey ||
      p.variant_key ||
      `${p.id}:${selectedBatchId || "catalog"}:${sellingPrice}:${mrp}`,
  );
  return {
    id: p.id,
    cartKey: variantKey,
    variantKey,
    selectedBatchId,
    selectedBatchIds,
    name: p.name,
    sku: p.sku || "",
    barcode: p.barcode || "",
    unit: normalizeUnit(p.unit || p.unit_name || p.measurement_unit || "PCS"),
    mrp,
    sellingPrice,
    costPrice: toNumber(p.cost_price || p.costPrice, 0),
    availableStock: toNumber(
      p.availableStock ?? p.available_stock ?? p.stock,
      0,
    ),
    expiredStock: toNumber(p.expiredStock ?? p.expired_stock, 0),
    categoryName: p.categoryName || p.category_name || "N/A",
    taxRate: toNumber(p.taxRate ?? p.tax_rate, 0),
    allowDiscountOnPos: Boolean(
      p.allow_discount_on_pos ?? p.allowDiscountOnPos,
    ),
    includeTax: Boolean(p.includeTax ?? p.include_tax),
  };
}

function getCartItemKey(item) {
  return String(item.cartKey || item.variantKey || item.id);
}

function calculateGstLine(item, canManageDiscounts = true) {
  const qty = toNumber(item.qty, 1);
  const sellingPrice = toNumber(item.sellingPrice ?? item.selling_price);
  const discountAmount =
    canManageDiscounts && item.allowDiscountOnPos
      ? toNumber(item.discountAmount)
      : 0;
  const gross = Math.max(0, qty * sellingPrice - discountAmount);
  const rate = toNumber(item.taxRate || 0);
  if (!rate || gross <= 0)
    return { gstAmount: 0, exclusiveGstAmount: 0, lineTotal: gross };
  if (item.includeTax) {
    return {
      gstAmount: gross - gross / (1 + rate / 100),
      exclusiveGstAmount: 0,
      lineTotal: gross,
    };
  }
  const gstAmount = (gross * rate) / 100;
  return {
    gstAmount,
    exclusiveGstAmount: gstAmount,
    lineTotal: gross + gstAmount,
  };
}

function calculateRoundOff(amount) {
  const normalizedAmount = Math.round(toNumber(amount) * 100) / 100;
  const roundedAmount = Math.round(normalizedAmount);
  return Math.round((roundedAmount - normalizedAmount) * 100) / 100;
}

// ============================================================================
// STORAGE
// ============================================================================

const STORAGE_KEYS = {
  CACHE: "pos-cache-v3",
  DRAFT: "pos-draft-v3",
  HELD_BILLS: "pos-held-bills-v3",
  QUEUE: "pos-queue-v3",
  OFFLINE_BILLS: "pos-offline-bills-v3",
};

function readStorage(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

async function loadReceiptConfig() {
  try {
    const [receiptRes, businessRes] = await Promise.all([
      fetch("/api/settings/customize-receipt-print?pageSize=1&isActive=true", {
        cache: "no-store",
        credentials: "include",
      }),
      fetch("/api/settings/business-info?pageSize=1&isActive=true", {
        cache: "no-store",
        credentials: "include",
      }),
    ]);
    const receiptJson = await receiptRes.json();
    const businessJson = await businessRes.json();
    const config = receiptJson.data?.records?.[0]?.config || {};
    const business = businessJson.data?.records?.[0]?.config || {};
    return {
      ...DEFAULT_RECEIPT_CONFIG,
      ...config,
      businessName:
        config.businessName ||
        business.legalName ||
        DEFAULT_RECEIPT_CONFIG.businessName,
      headerText: config.headerText || business.address || "",
    };
  } catch {
    return DEFAULT_RECEIPT_CONFIG;
  }
}

function getOrCreateLocalId(key, prefix) {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(key, next);
  return next;
}

function createFixedPaymentRows(sourcePayments = []) {
  const sourceByMethod = new Map();

  for (const payment of Array.isArray(sourcePayments) ? sourcePayments : []) {
    const method = String(payment?.method || "")
      .trim()
      .toLowerCase();
    if (!method) continue;
    sourceByMethod.set(method, {
      method,
      amount: String(payment?.amount ?? ""),
      referenceNo: String(payment?.referenceNo ?? payment?.reference_no ?? ""),
    });
  }

  return FIXED_PAYMENT_METHODS.map(
    (method) =>
      sourceByMethod.get(method.method) || {
        method: method.method,
        amount: "",
        referenceNo: "",
      },
  );
}

// ============================================================================
// MAIN POS COMPONENT
// ============================================================================

export default function POSPage() {
  const router = useRouter();
  const searchInputRef = useRef(null);
  const scalePortRef = useRef(null);
  const scaleReaderRef = useRef(null);
  const scaleUsbDeviceRef = useRef(null);
  const scaleUsbLoopRef = useRef(false);
  const activeScaleCartKeyRef = useRef("");

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [stores, setStores] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [deviceUid, setDeviceUid] = useState("");
  const [counterName, setCounterName] = useState("");
  // State: Products & Search
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [priceVariantOptions, setPriceVariantOptions] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [orderDiscount, setOrderDiscount] = useState("0");
  const [roundOff, setRoundOff] = useState("0");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [payments, setPayments] = useState(() => createFixedPaymentRows());
  const [paymentOptions, setPaymentOptions] = useState(DEFAULT_PAYMENT_OPTIONS);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [toast, setToast] = useState(null);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleWeightKg, setScaleWeightKg] = useState(0);
  const [scaleStatus, setScaleStatus] = useState("");
  const [activeScaleCartKey, setActiveScaleCartKey] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [openSessionModal, setOpenSessionModal] = useState(false);
  const [closeSessionModal, setCloseSessionModal] = useState(false);
  const [customerHistoryModal, setCustomerHistoryModal] = useState(false);
  const [customerHistory, setCustomerHistory] = useState([]);
  const [closingSummary, setClosingSummary] = useState(null);
  const [closingLoading, setClosingLoading] = useState(false);
  const [actualCash, setActualCash] = useState("0");
  const [closingRemarks, setClosingRemarks] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [recentBills, setRecentBills] = useState([]);
  const [heldBills, setHeldBills] = useState([]);
  const [receiptModal, setReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [receiptQR, setReceiptQR] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("");
  const [holdDetectModal, setHoldDetectModal] = useState(false);
  const [detectedHeldBills, setDetectedHeldBills] = useState([]);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scannerStopRef = useRef(false);

  // ── TOAST ──
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const applyScaleWeightReading = useCallback((raw) => {
    const weightKg = parseScaleWeight(raw);
    if (weightKg === null) return false;

    const normalizedWeight = Number(weightKg.toFixed(3));
    setScaleWeightKg(normalizedWeight);
    setScaleStatus(formatScaleWeight(normalizedWeight));
    const activeCartKey = activeScaleCartKeyRef.current;
    if (activeCartKey) {
      setCart((current) =>
        current.map((item) => {
          if (getCartItemKey(item) !== activeCartKey) return item;
          const weightedUnit = getWeightedUnitKind(item.unit);
          if (!weightedUnit) return item;
          const nextQty = Math.min(
            getScaleQuantityForUnit(normalizedWeight, weightedUnit),
            toNumber(item.availableStock),
          );
          return Number(item.qty) === nextQty
            ? item
            : { ...item, qty: nextQty };
        }),
      );
    }
    return true;
  }, []);

  const disconnectScale = useCallback(async () => {
    scaleUsbLoopRef.current = false;
    try {
      await scaleReaderRef.current?.cancel();
    } catch {}
    try {
      scaleReaderRef.current?.releaseLock?.();
    } catch {}
    try {
      await scalePortRef.current?.close();
    } catch {}
    try {
      await scaleUsbDeviceRef.current?.close();
    } catch {}
    scaleReaderRef.current = null;
    scalePortRef.current = null;
    scaleUsbDeviceRef.current = null;
    setScaleConnected(false);
    setScaleWeightKg(0);
    setScaleStatus("");
    activeScaleCartKeyRef.current = "";
    setActiveScaleCartKey("");
  }, []);

  const connectScaleWithWebUsb = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.usb) {
      showToast(
        "This POS browser cannot access USB scale. Open this page in Chrome/Edge, or install a POS browser that supports USB/WebUSB.",
        "error",
      );
      return;
    }

    let device;
    try {
      device = await navigator.usb.requestDevice({ filters: [] });
      await device.open();
      if (!device.configuration) await device.selectConfiguration(1);

      let selectedInterface = null;
      let selectedAlternate = null;
      let inputEndpoint = null;
      for (const usbInterface of device.configuration.interfaces || []) {
        for (const alternate of usbInterface.alternates || []) {
          const endpoint = (alternate.endpoints || []).find(
            (candidate) =>
              candidate.direction === "in" &&
              ["bulk", "interrupt"].includes(candidate.type),
          );
          if (endpoint) {
            selectedInterface = usbInterface;
            selectedAlternate = alternate;
            inputEndpoint = endpoint;
            break;
          }
        }
        if (inputEndpoint) break;
      }

      if (!selectedInterface || !inputEndpoint) {
        throw new Error("No readable USB endpoint found for this scale.");
      }

      await device.claimInterface(selectedInterface.interfaceNumber);
      if (selectedAlternate?.alternateSetting) {
        await device.selectAlternateInterface(
          selectedInterface.interfaceNumber,
          selectedAlternate.alternateSetting,
        );
      }

      scaleUsbDeviceRef.current = device;
      scaleUsbLoopRef.current = true;
      setScaleConnected(true);
      setScaleStatus("Scale connected · USB");
      showToast("Weighing scale connected through USB", "success");

      const decoder = new TextDecoder();
      let buffer = "";
      while (scaleUsbLoopRef.current) {
        const result = await device.transferIn(
          inputEndpoint.endpointNumber,
          64,
        );
        if (!scaleUsbLoopRef.current) break;
        if (!result?.data) continue;
        buffer += decoder.decode(result.data, { stream: true });
        const chunks = buffer.split(/\r?\n/);
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          applyScaleWeightReading(chunk);
        }
        if (buffer.length >= 8 && applyScaleWeightReading(buffer)) {
          buffer = "";
        }
      }
    } catch (err) {
      scaleUsbLoopRef.current = false;
      setScaleConnected(false);
      setScaleStatus("");
      if (err?.name !== "NotFoundError") {
        showToast(
          err?.message ||
            "Unable to connect USB scale. Try Chrome/Edge or check USB permission.",
          "error",
        );
      }
      try {
        await device?.close();
      } catch {}
    }
  }, [applyScaleWeightReading]);

  const connectScale = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.serial) {
      await connectScaleWithWebUsb();
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open(EAGLE_SCALE_SERIAL_OPTIONS);
      scalePortRef.current = port;
      setScaleConnected(true);
      setScaleStatus("Scale connected · 9600 8N1");
      showToast("Weighing scale connected", "success");

      const decoder = new TextDecoder();
      const reader = port.readable.getReader();
      scaleReaderRef.current = reader;
      let buffer = "";
      const applyWeight = (raw) => {
        return applyScaleWeightReading(raw);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value || new Uint8Array(), { stream: true });
        const chunks = buffer.split(/\r?\n/);
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          applyWeight(chunk);
        }
        if (buffer.length >= 8 && applyWeight(buffer)) {
          buffer = "";
        }
      }
    } catch (err) {
      setScaleConnected(false);
      setScaleStatus("");
      if (err?.name !== "NotFoundError") {
        showToast(err?.message || "Unable to connect weighing scale", "error");
      }
    }
  }, [applyScaleWeightReading, connectScaleWithWebUsb]);

  useEffect(
    () => () => {
      disconnectScale();
    },
    [disconnectScale],
  );

  const canManageDiscounts =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.permissions?.includes("*") ||
    user?.permissions?.includes("MANAGE_BILLING");
  const canApplyOrderDiscount =
    canManageDiscounts &&
    cart.length > 0 &&
    cart.every((item) => item.allowDiscountOnPos);

  // ── DATA LOADING ──
  const loadPOSData = useCallback(
    async (storeIdOverride = "") => {
      setLoading(true);
      try {
        const activeStoreId =
          storeIdOverride || session?.storeId || selectedStoreId;
        const params = new URLSearchParams({ pageSize: "100" });
        if (activeStoreId) params.set("store_id", String(activeStoreId));
        if (deviceUid) {
          params.set("device_uid", deviceUid);
          params.set("counter_uid", deviceUid);
        }
        const res = await fetch(`/api/sales-order/pos?${params}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (json.success && json.data) {
          const mappedProducts = (json.data.products || []).map(
            normalizeProduct,
          );
          setProducts(mappedProducts);
          setFilteredProducts(mappedProducts);
          setStores(json.data.stores || []);
          setRecentBills(json.data.recentBills || []);
          setPaymentOptions(normalizePaymentOptions(json.data.paymentModes));
          if (json.data.session?.sessionId) {
            setSession(json.data.session);
            setSelectedStoreId(String(json.data.session.storeId || ""));
            setOpeningCash(String(json.data.session.openingCash || 0));
          } else if (json.data.selectedStoreId) {
            setSelectedStoreId(String(json.data.selectedStoreId));
            setOpeningCash("0");
          } else {
            setSession(null);
          }
          writeStorage(STORAGE_KEYS.CACHE, {
            products: mappedProducts,
            stores: json.data.stores || [],
            recentBills: json.data.recentBills || [],
            paymentOptions: normalizePaymentOptions(json.data.paymentModes),
          });
        }
      } catch {
        const cached = readStorage(STORAGE_KEYS.CACHE, null);
        if (cached?.products) {
          setProducts(cached.products);
          setFilteredProducts(cached.products);
          setStores(cached.stores || []);
          setRecentBills(cached.recentBills || []);
          setPaymentOptions(normalizePaymentOptions(cached.paymentOptions));
        }
      } finally {
        setLoading(false);
      }
    },
    [selectedStoreId, session?.storeId, deviceUid],
  );

  const loadAuth = useCallback(async () => {
    try {
      const res = await fetchAuthEndpoint("/api/auth/me");
      const json = await res.json();
      if (json.success && json.data?.user) setUser(json.data.user);
    } catch {}
  }, []);

  // ── SEARCH ──
  useEffect(() => {
    if (!search.trim()) {
      setFilteredProducts(products);
      return;
    }
    const needle = search.toLowerCase();
    setFilteredProducts(
      products.filter(
        (p) =>
          (p.name && p.name.toLowerCase().includes(needle)) ||
          (p.sku && p.sku.toLowerCase().includes(needle)) ||
          (p.barcode && p.barcode.toLowerCase().includes(needle)),
      ),
    );
  }, [search, products]);

  // ── OFFLINE SYNC ──
  const syncOfflineQueue = useCallback(async () => {
    const queue = readStorage(STORAGE_KEYS.QUEUE, []);
    if (queue.length === 0) return;

    let synced = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        const res = await fetch("/api/sales-order/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...item.payload,
            payments:
              Array.isArray(item.payload.payments) &&
              item.payload.payments.length
                ? item.payload.payments
                : [
                    {
                      method: item.payload.paymentMode,
                      amount: toNumber(item.totals?.grandTotal || 0),
                    },
                  ],
          }),
        });
        const json = await res.json();
        if (json.success) {
          synced++;
          const savedBill = json.data?.bill;
          if (savedBill) {
            // Replace the local offline bill with the confirmed server bill
            setRecentBills((current) => {
              const filtered = current.filter(
                (b) =>
                  b.billNumber !== item.payload.invoiceNumber &&
                  b.invoiceNumber !== item.payload.invoiceNumber,
              );
              return [{ ...savedBill, isOffline: false }, ...filtered].slice(
                0,
                20,
              );
            });
          }
          // Remove from offline-bills storage too
          const offlineBills = readStorage(STORAGE_KEYS.OFFLINE_BILLS, []);
          writeStorage(
            STORAGE_KEYS.OFFLINE_BILLS,
            offlineBills.filter(
              (b) => b.billNumber !== item.payload.invoiceNumber,
            ),
          );
        } else {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
      }
    }

    writeStorage(STORAGE_KEYS.QUEUE, remaining);
    setPendingQueueCount(remaining.length);
    if (synced > 0) {
      showToast(
        `✓ ${synced} offline bill${synced > 1 ? "s" : ""} synced & stock updated!`,
      );
      loadPOSData(); // Refresh products to show updated stock
    }
  }, [loadPOSData]);

  // ── INIT ──
  useEffect(() => {
    const localDeviceUid = getOrCreateLocalId("pos-device-uid-v1", "POSDEV");
    const savedCounterName =
      typeof window !== "undefined"
        ? window.localStorage.getItem("pos-counter-name-v1")
        : "";
    setDeviceUid(localDeviceUid);
    if (savedCounterName) setCounterName(savedCounterName);
    loadAuth();
    setHeldBills(readStorage(STORAGE_KEYS.HELD_BILLS, []));
    // Restore offline bills into recent bills on page load
    const savedOfflineBills = readStorage(STORAGE_KEYS.OFFLINE_BILLS, []);
    if (savedOfflineBills.length > 0) {
      setRecentBills((current) => {
        const merged = [...savedOfflineBills, ...current];
        const seen = new Set();
        return merged
          .filter((b) => {
            const key = b.billNumber || b.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 20);
      });
    }
    setIsOffline(typeof navigator !== "undefined" ? !navigator.onLine : false);
    setPendingQueueCount(readStorage(STORAGE_KEYS.QUEUE, []).length);
    if (searchInputRef.current) searchInputRef.current.focus();
  }, [loadAuth]);

  const loadHeldBills = useCallback(async () => {
    const activeStoreId = session?.storeId || selectedStoreId;
    if (!activeStoreId) {
      setHeldBills(readStorage(STORAGE_KEYS.HELD_BILLS, []));
      return;
    }
    try {
      const params = new URLSearchParams({
        store_id: String(activeStoreId),
        limit: "100",
      });
      const res = await fetch(`/api/pos/held-bills?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        const serverHeld = Array.isArray(json.data?.heldBills)
          ? json.data.heldBills
          : [];
        setHeldBills(serverHeld);
        writeStorage(STORAGE_KEYS.HELD_BILLS, serverHeld);
        return;
      }
    } catch {}
    setHeldBills(readStorage(STORAGE_KEYS.HELD_BILLS, []));
  }, [selectedStoreId, session?.storeId]);

  useEffect(() => {
    loadHeldBills();
  }, [loadHeldBills]);

  useEffect(() => {
    if (paymentOptions.some((option) => option.value === paymentMode)) return;
    const nextMode = paymentOptions[0]?.value || "cash";
    setPaymentMode(nextMode);
    setPayments((current) =>
      current.map((payment) => ({
        ...payment,
        method: payment.method || nextMode,
      })),
    );
  }, [paymentMode, paymentOptions]);

  // Online / Offline event listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      const pending = readStorage(STORAGE_KEYS.QUEUE, []);
      if (pending.length > 0) {
        syncOfflineQueue(); // Auto-sync silently; toast shown after success
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      showToast("You are offline. Bills will be saved locally.", "error");
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, [syncOfflineQueue]);

  useEffect(() => {
    if (!deviceUid) return;
    loadPOSData();
    // Auto-sync any pending bills when POS loads while online
    if (typeof navigator !== "undefined" && navigator.onLine) {
      const pending = readStorage(STORAGE_KEYS.QUEUE, []);
      if (pending.length > 0) syncOfflineQueue();
    }
  }, [deviceUid, loadPOSData, syncOfflineQueue]);

  useEffect(() => {
    const draft = readStorage(STORAGE_KEYS.DRAFT, null);
    if (!draft) return;
    setCart(draft.cart || []);
    setCustomerName(draft.customerName || "");
    setCustomerMobile(
      draft.customerMobile
        ? String(draft.customerMobile).replace(/\D/g, "").slice(0, 10)
        : "",
    );
    setOrderDiscount(String(draft.orderDiscount ?? "0"));
    setRoundOff(String(draft.roundOff ?? "0"));
    setPaymentMode(draft.paymentMode || "cash");
    setPayments(createFixedPaymentRows(draft.payments));
  }, []);

  useEffect(() => {
    const token =
      receiptData?.bill?.publicToken || receiptData?.bill?.public_token;
    if (!token || !receiptModal) {
      setReceiptQR("");
      return;
    }
    generateQRDataURL(getInvoiceURL(token), { size: 160 })
      .then(setReceiptQR)
      .catch(() => setReceiptQR(""));
  }, [receiptData, receiptModal]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.DRAFT, {
      cart,
      customerName,
      customerMobile,
      orderDiscount,
      roundOff,
      paymentMode,
      payments,
    });
  }, [
    cart,
    customerName,
    customerMobile,
    orderDiscount,
    roundOff,
    paymentMode,
    payments,
  ]);

  // ── BARCODE ──
  useEffect(() => {
    if (!scannerOpen) return undefined;
    let detector = null;
    let rafId = 0;

    const stopScanner = () => {
      scannerStopRef.current = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    const startScanner = async () => {
      scannerStopRef.current = false;
      setScannerError("");
      setScannerStatus("Opening camera...");
      try {
        if (
          typeof window === "undefined" ||
          !navigator?.mediaDevices?.getUserMedia
        ) {
          throw new Error("Camera access is not available in this browser.");
        }
        if (!("BarcodeDetector" in window)) {
          throw new Error(
            "This browser does not support live barcode detection. Use the scan box with a hardware scanner.",
          );
        }
        detector = new window.BarcodeDetector({
          formats: [
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "code_128",
            "code_39",
            "qr_code",
          ],
        });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setScannerStatus("Point camera at the barcode");

        const scanFrame = async () => {
          if (scannerStopRef.current || !videoRef.current || !detector) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const code = codes?.[0]?.rawValue;
            if (code) {
              stopScanner();
              setScannerOpen(false);
              await handleBarcode(code);
              return;
            }
          } catch {}
          rafId = requestAnimationFrame(scanFrame);
        };
        rafId = requestAnimationFrame(scanFrame);
      } catch (err) {
        setScannerStatus("");
        setScannerError(err.message || "Unable to start camera scanner.");
      }
    };

    startScanner();
    return stopScanner;
  }, [scannerOpen]);

  const handleBarcode = async (value) => {
    const code = value?.trim();
    if (!code) return;
    const localMatches = products.filter(
      (p) =>
        (p.barcode && String(p.barcode) === code) ||
        (p.sku && String(p.sku) === code) ||
        String(p.id) === code,
    );
    if (localMatches.length > 1) {
      setPriceVariantOptions(localMatches);
      setSearch("");
      return;
    }
    if (localMatches.length === 1) {
      addProduct(localMatches[0]);
      setSearch("");
      if (searchInputRef.current) searchInputRef.current.focus();
      return;
    }
    try {
      const activeStoreId = session?.storeId || selectedStoreId;
      const params = new URLSearchParams({ search: code, pageSize: "20" });
      if (activeStoreId) params.set("store_id", String(activeStoreId));
      const res = await fetch(`/api/sales-order/pos?${params}`);
      const json = await res.json();
      const matches = (
        json.success ? (json.data?.products || []).map(normalizeProduct) : []
      ).filter(
        (p) =>
          (p.barcode && String(p.barcode) === code) ||
          (p.sku && String(p.sku) === code) ||
          String(p.id) === code,
      );
      if (matches.length > 1) {
        setPriceVariantOptions(matches);
        setSearch("");
      } else if (matches.length === 1 || json.data?.products?.[0]) {
        addProduct(matches[0] || normalizeProduct(json.data.products[0]));
        setSearch("");
      } else showToast("Product not found", "error");
    } catch {
      showToast("Failed to lookup product", "error");
    } finally {
      if (searchInputRef.current) searchInputRef.current.focus();
    }
  };

  // ── CART ──
  const addProduct = (product) => {
    if (toNumber(product.availableStock) <= 0) {
      if (toNumber(product.expiredStock) > 0) {
        showToast(
          `${product.name} has ${product.expiredStock} expired stock. Billing is blocked for expired products.`,
          "error",
        );
        return;
      }
      showToast("No stock available", "error");
      return;
    }
    const weightedUnit = getWeightedUnitKind(product.unit);
    const weighted = Boolean(weightedUnit);
    const scaleQty = Number(scaleWeightKg.toFixed(3));
    if (weighted && scaleQty <= 0) {
      showToast(
        "Place item on weighing scale before adding this product.",
        "error",
      );
      return;
    }
    const nextQty = weighted
      ? getScaleQuantityForUnit(scaleQty, weightedUnit)
      : 1;
    if (nextQty > toNumber(product.availableStock)) {
      showToast(
        `Only ${product.availableStock} ${product.unit || "qty"} available`,
        "error",
      );
      return;
    }
    const sellingPrice = product.sellingPrice || product.mrp || 0;
    const mrp = product.mrp || 0;
    const discountAmount =
      canManageDiscounts && product.allowDiscountOnPos
        ? Math.max(0, mrp - sellingPrice)
        : 0;
    const cartKey = getCartItemKey(product);
    if (weighted) {
      activeScaleCartKeyRef.current = cartKey;
      setActiveScaleCartKey(cartKey);
    }
    setCart((current) => {
      const existing = current.find((item) => getCartItemKey(item) === cartKey);
      if (existing)
        return current.map((item) =>
          getCartItemKey(item) === cartKey
            ? {
                ...item,
                qty: weighted
                  ? nextQty
                  : Math.min(
                      Number((item.qty + nextQty).toFixed(3)),
                      toNumber(product.availableStock),
                    ),
                discountAmount,
                sellingPrice,
              }
            : item,
        );
      return [
        ...current,
        { ...product, cartKey, qty: nextQty, discountAmount, sellingPrice },
      ];
    });
  };

  useEffect(() => {
    activeScaleCartKeyRef.current = activeScaleCartKey;
  }, [activeScaleCartKey]);

  useEffect(() => {
    if (!scaleConnected || !activeScaleCartKey) return;
    setCart((current) =>
      current.map((item) => {
        if (getCartItemKey(item) !== activeScaleCartKey) return item;
        const weightedUnit = getWeightedUnitKind(item.unit);
        if (!weightedUnit) return item;
        const nextQty = Math.min(
          getScaleQuantityForUnit(scaleWeightKg, weightedUnit),
          toNumber(item.availableStock),
        );
        if (Number(item.qty) === nextQty) return item;
        return { ...item, qty: nextQty };
      }),
    );
  }, [activeScaleCartKey, scaleConnected, scaleWeightKg]);

  const updateCartItem = (key, field, value) =>
    setCart((current) =>
      current.map((item) =>
        getCartItemKey(item) === String(key)
          ? { ...item, [field]: value }
          : item,
      ),
    );

  const removeCartItem = (key) => {
    if (activeScaleCartKey === String(key)) {
      activeScaleCartKeyRef.current = "";
      setActiveScaleCartKey("");
    }
    setCart((current) =>
      current.filter((item) => getCartItemKey(item) !== String(key)),
    );
  };

  const clearCart = () => {
    setCart([]);
    activeScaleCartKeyRef.current = "";
    setActiveScaleCartKey("");
    setCustomerName("");
    setCustomerMobile("");
    setOrderDiscount("0");
    setRoundOff("0");
    setPayments(createFixedPaymentRows());
    setPaymentMode("cash");
    setSearch("");
  };

  const saveHeldBills = (next) => {
    setHeldBills(next);
    writeStorage(STORAGE_KEYS.HELD_BILLS, next);
  };

  const saveHeldBillToServer = async (heldBill) => {
    const activeStoreId = session?.storeId || selectedStoreId;
    if (
      !activeStoreId ||
      isOffline ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    )
      return null;
    try {
      const res = await fetch("/api/pos/held-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...heldBill,
          storeId: activeStoreId,
          sessionId: session?.sessionId || null,
          deviceUid,
          counterUid: deviceUid,
          counterName: session?.counterName || counterName,
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.heldBill) return json.data.heldBill;
    } catch {}
    return null;
  };

  const removeHeldBillFromServer = async (id) => {
    if (
      !id ||
      isOffline ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    )
      return;
    try {
      await fetch(`/api/pos/held-bills?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {}
  };

  const buildHeldBill = () => ({
    id: `HOLD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    heldAt: new Date().toISOString(),
    storeId: session?.storeId || selectedStoreId,
    sessionId: session?.sessionId || null,
    cart,
    customerName,
    customerMobile,
    orderDiscount,
    roundOff,
    paymentMode,
    payments,
    totals: cartTotals,
  });

  const holdCurrentBill = async () => {
    if (cart.length === 0) {
      showToast("Add products before holding bill", "error");
      return;
    }
    const heldBill = buildHeldBill();
    saveHeldBills([heldBill, ...heldBills].slice(0, 25));
    clearCart();
    const serverHeld = await saveHeldBillToServer(heldBill);
    if (serverHeld) {
      const next = [
        serverHeld,
        ...heldBills.filter((b) => b.id !== heldBill.id),
      ].slice(0, 100);
      saveHeldBills(next);
    }
    showToast(`Bill held for ${heldBill.customerName || "Walk-in Customer"}`);
  };

  const resumeHeldBill = async (heldBill) => {
    if (cart.length > 0) {
      showToast("Hold or clear current bill before resuming", "error");
      return;
    }
    setCart(heldBill.cart || []);
    setCustomerName(heldBill.customerName || "");
    setCustomerMobile(
      heldBill.customerMobile
        ? String(heldBill.customerMobile).replace(/\D/g, "").slice(0, 10)
        : "",
    );
    setOrderDiscount(String(heldBill.orderDiscount ?? "0"));
    setRoundOff(String(heldBill.roundOff ?? "0"));
    setPaymentMode(heldBill.paymentMode || "cash");
    setPayments(createFixedPaymentRows(heldBill.payments));
    saveHeldBills(heldBills.filter((b) => b.id !== heldBill.id));
    await removeHeldBillFromServer(heldBill.id);
    setHoldDetectModal(false);
    setDetectedHeldBills([]);
    showToast("Held bill resumed");
    if (searchInputRef.current) searchInputRef.current.focus();
  };

  const removeHeldBill = async (id) => {
    saveHeldBills(heldBills.filter((b) => b.id !== id));
    await removeHeldBillFromServer(id);
    showToast("Held bill removed", "info");
  };

  const checkForHeldBills = (mobile) => {
    if (!mobile || mobile.length < 10) return;
    const normalized = mobile.replace(/\D/g, "").slice(0, 10);
    const matches = heldBills
      .filter(
        (b) =>
          b.customerMobile &&
          b.customerMobile.replace(/\D/g, "").slice(0, 10) === normalized,
      )
      .sort((a, b) => new Date(b.heldAt || 0) - new Date(a.heldAt || 0));
    if (matches.length > 0) {
      setDetectedHeldBills(matches);
      setHoldDetectModal(true);
    }
  };

  const holdCurrentAndResume = async (heldBill) => {
    const withoutTarget = heldBills.filter((b) => b.id !== heldBill.id);
    let nextHeldBills = withoutTarget;
    if (cart.length > 0) {
      const currentHeld = buildHeldBill();
      nextHeldBills = [currentHeld, ...withoutTarget].slice(0, 25);
      saveHeldBillToServer(currentHeld).then((serverHeld) => {
        if (serverHeld) {
          saveHeldBills([serverHeld, ...withoutTarget].slice(0, 100));
        }
      });
    }
    setCart(heldBill.cart || []);
    setCustomerName(heldBill.customerName || "");
    setCustomerMobile(
      heldBill.customerMobile
        ? String(heldBill.customerMobile).replace(/\D/g, "").slice(0, 10)
        : "",
    );
    setOrderDiscount(String(heldBill.orderDiscount ?? "0"));
    setRoundOff(String(heldBill.roundOff ?? "0"));
    setPaymentMode(heldBill.paymentMode || "cash");
    setPayments(createFixedPaymentRows(heldBill.payments));
    saveHeldBills(nextHeldBills);
    await removeHeldBillFromServer(heldBill.id);
    setHoldDetectModal(false);
    setDetectedHeldBills([]);
    showToast(
      cart.length > 0
        ? `Current cart held · Resumed ${heldBill.customerName || "held bill"}`
        : `Resumed ${heldBill.customerName || "held bill"}`,
    );
    if (searchInputRef.current) searchInputRef.current.focus();
  };

  // ── TOTALS ──
  const cartTotals = useMemo(() => {
    const subtotal = cart.reduce(
      (sum, item) => sum + item.qty * item.sellingPrice,
      0,
    );
    const lineDiscount = canManageDiscounts
      ? cart.reduce(
          (sum, item) =>
            sum + (item.allowDiscountOnPos ? toNumber(item.discountAmount) : 0),
          0,
        )
      : 0;
    const gstTotal = cart.reduce(
      (sum, item) => sum + calculateGstLine(item, canManageDiscounts).gstAmount,
      0,
    );
    const exclusiveGstTotal = cart.reduce(
      (sum, item) =>
        sum + calculateGstLine(item, canManageDiscounts).exclusiveGstAmount,
      0,
    );
    const discount =
      (canApplyOrderDiscount ? toNumber(orderDiscount) : 0) + lineDiscount;
    const amountBeforeRoundOff = Math.max(
      0,
      subtotal - discount + exclusiveGstTotal,
    );
    const roundValue = calculateRoundOff(amountBeforeRoundOff);
    const grandTotal = Math.max(
      0,
      Math.round((amountBeforeRoundOff + roundValue) * 100) / 100,
    );
    return {
      subtotal,
      lineDiscount,
      taxTotal: gstTotal,
      exclusiveGstTotal,
      discount,
      roundValue,
      grandTotal,
    };
  }, [cart, canApplyOrderDiscount, canManageDiscounts, orderDiscount]);

  useEffect(() => {
    const nextRoundOff = cartTotals.roundValue.toFixed(2);
    setRoundOff((current) =>
      current === nextRoundOff ? current : nextRoundOff,
    );
  }, [cartTotals.roundValue]);

  const normalizedPayments = useMemo(() => {
    const rows = payments
      .map((payment) => ({
        method: payment.method || paymentMode || "cash",
        amount: toNumber(payment.amount),
        referenceNo: payment.referenceNo || "",
      }))
      .filter((payment) => payment.amount > 0);

    if (!rows.length && cartTotals.grandTotal > 0) {
      return [
        {
          method: paymentMode || "cash",
          amount: cartTotals.grandTotal,
          referenceNo: "",
        },
      ];
    }
    return rows;
  }, [payments, paymentMode, cartTotals.grandTotal]);

  const paidTotal = useMemo(
    () =>
      normalizedPayments.reduce(
        (sum, payment) => sum + toNumber(payment.amount),
        0,
      ),
    [normalizedPayments],
  );
  const paymentBalance =
    Math.round((cartTotals.grandTotal - paidTotal) * 100) / 100;
  const isPaymentBalanced = Math.abs(paymentBalance) <= 0.01;
  const canGenerateBill =
    !!session?.sessionId &&
    cart.length > 0 &&
    !isProcessing &&
    isPaymentBalanced;
  const canCloseSessionNow = canClosePosSessionNow();

  const updatePayment = (index, field, value) => {
    setPayments((current) =>
      current.map((payment, idx) =>
        idx === index ? { ...payment, [field]: value } : payment,
      ),
    );
    if (field === "method" && index === 0) setPaymentMode(value);
  };

  const addPaymentRow = () => {
    const remaining = Math.max(
      0,
      Math.round((cartTotals.grandTotal - paidTotal) * 100) / 100,
    );
    setPayments((current) => [
      ...current,
      {
        method: "cash",
        amount: remaining ? String(remaining) : "",
        referenceNo: "",
      },
    ]);
  };

  const removePaymentRow = (index) => {
    setPayments((current) =>
      current.length <= 1 ? current : current.filter((_, idx) => idx !== index),
    );
  };

  // ── CUSTOMER HISTORY ──
  const loadCustomerHistory = async () => {
    if (!customerName.trim() && !customerMobile.trim()) {
      showToast("Enter customer name or mobile", "error");
      return;
    }
    try {
      const historyQuery = customerMobile || customerName;
      const activeStoreId = session?.storeId || selectedStoreId;
      const params = new URLSearchParams({ search: historyQuery });
      if (activeStoreId) params.set("store_id", String(activeStoreId));
      const res = await fetch(`/api/sales-order/customer-history?${params}`);
      const json = await res.json();
      if (json.success && json.data) {
        setCustomerHistory(json.data.bills || []);
        setCustomerHistoryModal(true);
      } else showToast("No history found", "info");
    } catch {
      showToast("Failed to load history", "error");
    }
  };

  const selectCustomerFromHistory = (bill) => {
    setCustomerName(bill.customerName || customerName);
    setCustomerMobile(
      bill.customerMobile
        ? String(bill.customerMobile).replace(/\D/g, "").slice(0, 10)
        : customerMobile || "",
    );
    if (bill.paymentMode) setPaymentMode(bill.paymentMode);
    setCustomerHistoryModal(false);
    showToast("Customer details filled from history");
  };

  const printReceipt = async (receipt = receiptData) => {
    if (!receipt || typeof window === "undefined") return;
    const bill = receipt.bill || {};
    const items = receipt.items || [];
    const receiptConfig = await loadReceiptConfig();
    const token = bill.publicToken || bill.public_token;
    const paymentText = formatPaymentBreakup(
      getReceiptPayments(receipt),
      bill.payment_mode || bill.paymentMode || "cash",
    );

    // Generate QR for the print window (async, non-blocking)
    let qrBlock = "";
    if (token && receiptConfig.showQr) {
      try {
        const url = getInvoiceURL(token);
        const qrData = await generateQRDataURL(url, { size: 160 });
        qrBlock = `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #94a3b8;text-align:center"><img src="${qrData}" alt="QR" style="width:96px;height:96px" /><p style="font-size:9px;color:#64748b;margin:4px 0 2px;font-weight:700">SCAN TO VIEW DIGITAL INVOICE</p><p style="font-size:8px;color:#94a3b8;word-break:break-all">${url}</p></div>`;
      } catch {}
    }
    const printWindow = window.open("", "_blank", "width=380,height=720");
    if (!printWindow) {
      showToast(
        "Popup blocked. Please allow popups to print receipt.",
        "error",
      );
      return;
    }

    const rows = items
      .map(
        (item) => `
      <tr>
        <td>${item.name || item.product_name || "Product"}${receiptConfig.showSku && item.sku ? `<br><small>${item.sku}</small>` : ""}</td>
        <td style="text-align:center">${toNumber(item.qty, 1)}</td>
        <td style="text-align:right">${formatCurrency(item.selling_price || item.sellingPrice || 0)}</td>
        <td style="text-align:right">${formatCurrency(item.line_total || toNumber(item.qty, 1) * toNumber(item.selling_price || item.sellingPrice))}</td>
      </tr>
    `,
      )
      .join("");

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Receipt ${bill.billNumber || bill.bill_number || ""}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 16px; font-size: 12px; }
            h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
            .muted { color: #475569; }
            .center { text-align: center; }
            .line { border-top: 1px dashed #94a3b8; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 5px 0; vertical-align: top; }
            th { border-bottom: 1px solid #cbd5e1; font-size: 11px; }
            .totals div { display: flex; justify-content: space-between; margin: 3px 0; }
            .grand { font-size: 16px; font-weight: 800; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>${receiptConfig.businessName || "Buyzaar Sync"}</h1>
          <div class="center muted">${receiptConfig.subtitle || "GST Invoice / POS Receipt"}</div>
          ${receiptConfig.headerText ? `<div class="center muted" style="white-space:pre-line;margin-top:6px">${receiptConfig.headerText}</div>` : ""}
          <div class="line"></div>
          <div><strong>Bill:</strong> ${bill.billNumber || bill.bill_number || bill.invoiceNumber || "-"}</div>
          <div><strong>Date & Time:</strong> ${formatReceiptDateTime(bill.createdAt || bill.created_at)}</div>
          <div><strong>Customer:</strong> ${bill.customerName || bill.customer_name || "Walk-in Customer"}</div>
          ${receiptConfig.showCustomerMobile && (bill.customerMobile || bill.customer_mobile) ? `<div><strong>Mobile:</strong> ${bill.customerMobile || bill.customer_mobile}</div>` : ""}
          <div class="line"></div>
          <table>
            <thead>
              <tr><th style="text-align:left">Item</th><th>Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amt</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="line"></div>
          <div class="totals">
            <div><span>Subtotal</span><strong>${formatCurrency(bill.subtotal || receipt.subtotal || 0)}</strong></div>
            ${receiptConfig.showDiscount ? `<div><span>Discount</span><strong>${formatCurrency(bill.discount_total || bill.discountTotal || receipt.discount || 0)}</strong></div>` : ""}
            ${receiptConfig.showTaxBreakup ? `<div><span>GST</span><strong>${formatCurrency(bill.tax_total || bill.totalTax || receipt.taxTotal || 0)}</strong></div>` : ""}
            <div class="grand"><span>Total</span><span>${formatCurrency(bill.grand_total || bill.grandTotal || receipt.grandTotal || 0)}</span></div>
            <div><span>Paid By</span><strong>${paymentText}</strong></div>
          </div>
          <div class="line"></div>
          <div class="center muted" style="white-space:pre-line">${receiptConfig.footerText || "Thank you. Visit again."}</div>
          ${qrBlock}
          <script>window.onload = () => { window.print(); window.close(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const openReceiptFromBill = async (bill) => {
    const billId =
      bill.billNumber || bill.invoiceNumber || bill.bill_number || bill.id;
    if (!billId) return;
    try {
      const res = await fetch(
        `/api/pos/billing?bill_id=${encodeURIComponent(billId)}`,
      );
      const json = await res.json();
      if (!json.success) {
        showToast(json.message || "Failed to load receipt", "error");
        return;
      }
      setReceiptData(json.data);
      setReceiptModal(true);
    } catch {
      showToast("Failed to load receipt", "error");
    }
  };

  // ── SESSION ──
  const openCloseSessionModal = async () => {
    if (!session?.sessionId) {
      showToast("No active session", "error");
      return;
    }
    setCloseSessionModal(true);
    setClosingLoading(true);
    try {
      const params = new URLSearchParams({ sessionId: session.sessionId });
      const res = await fetch(`/api/sales-order/closing?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success && json.data) {
        setClosingSummary(json.data);
        const expectedCash = json.data.totals?.expectedCash;
        if (expectedCash !== undefined && expectedCash !== null)
          setActualCash(String(expectedCash));
      } else
        showToast(json.message || "Failed to load closing summary", "error");
    } catch {
      showToast("Failed to load closing summary", "error");
    } finally {
      setClosingLoading(false);
    }
  };

  const openSession = async () => {
    if (!user) {
      showToast("Login first", "error");
      return;
    }
    if (!selectedStoreId) {
      showToast("Select a store", "error");
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch("/api/employee/user-counter-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          storeId: Number(selectedStoreId),
          counterName: counterName || "POS Counter",
          deviceUid,
          counterUid: deviceUid,
          openingCash: toNumber(openingCash),
        }),
      });
      const json = await res.json();
      if (res.ok && (json.success || json.id)) {
        const openedSession = json.data?.session || json;
        setSession(openedSession);
        setSelectedStoreId(String(openedSession.storeId || selectedStoreId));
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            "pos-counter-name-v1",
            counterName || "POS Counter",
          );
        }
        setOpenSessionModal(false);
        loadPOSData(openedSession.storeId || selectedStoreId);
        showToast("Session opened successfully");
      } else showToast(json.error || "Failed to open session", "error");
    } catch {
      showToast("Failed to open session", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const closeSession = async () => {
    if (!session?.sessionId) {
      showToast("No active session", "error");
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch("/api/sales-order/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          actualCash: toNumber(actualCash),
          handoverAmount: toNumber(actualCash),
          remarks: closingRemarks,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSession(null);
        setCloseSessionModal(false);
        setClosingSummary(null);
        setClosingRemarks("");
        setActualCash("0");
        clearCart();
        showToast("Session closed. Cash is pending manager verification.");
      } else showToast(json.message || "Failed to close session", "error");
    } catch {
      showToast("Failed to close session", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // ── CHECKOUT ──
  const saveBillOffline = (
    payload,
    toastMessage = "Bill saved offline - will sync when back online",
  ) => {
    const offlineBill = {
      id: `OFFLINE-${Date.now()}`,
      billNumber: payload.invoiceNumber,
      invoiceNumber: payload.invoiceNumber,
      customerName: payload.customerName,
      customerMobile,
      paymentMode,
      grandTotal: cartTotals.grandTotal,
      subtotal: cartTotals.subtotal,
      discountTotal: cartTotals.discount,
      taxTotal: cartTotals.taxTotal,
      createdAt: new Date().toISOString(),
      isOffline: true,
      status: "pending_sync",
    };

    const queue = readStorage(STORAGE_KEYS.QUEUE, []);
    queue.push({
      payload,
      totals: cartTotals,
      createdAt: new Date().toISOString(),
    });
    writeStorage(STORAGE_KEYS.QUEUE, queue);
    setPendingQueueCount(queue.length);

    const offlineBills = readStorage(STORAGE_KEYS.OFFLINE_BILLS, []);
    writeStorage(
      STORAGE_KEYS.OFFLINE_BILLS,
      [offlineBill, ...offlineBills].slice(0, 20),
    );
    setRecentBills((current) => [offlineBill, ...current].slice(0, 20));

    const receiptItems = cart.map((item) => ({
      ...item,
      name: item.name,
      selling_price: item.sellingPrice,
      line_total: calculateGstLine(item, canManageDiscounts).lineTotal,
    }));

    setReceiptData({
      bill: {
        ...offlineBill,
        publicToken: null,
      },
      items: receiptItems,
      subtotal: cartTotals.subtotal,
      discount: cartTotals.discount,
      taxTotal: cartTotals.taxTotal,
      grandTotal: cartTotals.grandTotal,
    });
    setReceiptModal(true);

    showToast(toastMessage, "info");
    clearCart();
  };

  const createBill = async () => {
    if (!session?.sessionId) {
      showToast("Open session first", "error");
      return;
    }
    if (cart.length === 0) {
      showToast("Add products to cart", "error");
      return;
    }
    const normalizedCustomerName = customerName.trim() || "Walk-in Customer";
    if (!customerMobile.trim()) {
      showToast("Customer mobile number is required for billing", "error");
      return;
    }
    if (!validatePhoneNumber(customerMobile).isValid) {
      showToast(validatePhoneNumber(customerMobile).error, "error");
      return;
    }
    if (!isPaymentBalanced) {
      showToast(
        `Payment total must match bill total. Balance ${formatCurrency(paymentBalance)}`,
        "error",
      );
      return;
    }
    setIsProcessing(true);
    let payload = null;
    try {
      payload = {
        sessionId: session.sessionId,
        storeId: session.storeId || selectedStoreId,
        deviceUid,
        counterUid: deviceUid,
        counterName: session.counterName || counterName,
        customerName: normalizedCustomerName,
        customerMobile,
        paymentMode:
          normalizedPayments.length > 1
            ? "split"
            : normalizedPayments[0]?.method || paymentMode,
        payments: normalizedPayments,
        items: cart.map((item) => ({
          productId: item.id,
          name: item.name,
          qty: item.qty,
          sellingPrice: item.sellingPrice,
          mrp: item.mrp,
          barcode: item.barcode,
          sku: item.sku,
          selectedBatchId: item.selectedBatchId,
          selectedBatchIds: item.selectedBatchIds || [],
          taxRate: item.taxRate || 0,
          includeTax: item.includeTax,
          discountAmount:
            canManageDiscounts && item.allowDiscountOnPos
              ? toNumber(item.discountAmount)
              : 0,
        })),
        orderDiscount: canApplyOrderDiscount ? toNumber(orderDiscount) : 0,
        roundOff: cartTotals.roundValue,
        invoiceNumber: generateInvoiceNumber(),
      };
      if (isOffline || !navigator.onLine) {
        // 1. Build a local offline bill object
        const offlineBill = {
          id: `OFFLINE-${Date.now()}`,
          billNumber: payload.invoiceNumber,
          invoiceNumber: payload.invoiceNumber,
          customerName: payload.customerName,
          customerMobile,
          paymentMode: payload.paymentMode,
          payments: normalizedPayments,
          grandTotal: cartTotals.grandTotal,
          subtotal: cartTotals.subtotal,
          discountTotal: cartTotals.discount,
          taxTotal: cartTotals.taxTotal,
          createdAt: new Date().toISOString(),
          isOffline: true,
          status: "pending_sync",
        };

        // 2. Save to offline queue for later server sync
        const queue = readStorage(STORAGE_KEYS.QUEUE, []);
        queue.push({
          payload,
          totals: cartTotals,
          createdAt: new Date().toISOString(),
        });
        writeStorage(STORAGE_KEYS.QUEUE, queue);
        setPendingQueueCount(queue.length);

        // 3. Persist offline bill so it survives page refresh
        const offlineBills = readStorage(STORAGE_KEYS.OFFLINE_BILLS, []);
        writeStorage(
          STORAGE_KEYS.OFFLINE_BILLS,
          [offlineBill, ...offlineBills].slice(0, 20),
        );

        // 4. Add to recent bills immediately (visible in UI right now)
        setRecentBills((current) => [offlineBill, ...current].slice(0, 20));

        // 5. Build receipt items for printing
        const receiptItems = cart.map((item) => ({
          ...item,
          name: item.name,
          selling_price: item.sellingPrice,
          line_total: calculateGstLine(item, canManageDiscounts).lineTotal,
        }));

        // 6. Show receipt modal so cashier can print immediately
        setReceiptData({
          bill: {
            ...offlineBill,
            publicToken: null,
          },
          items: receiptItems,
          subtotal: cartTotals.subtotal,
          discount: cartTotals.discount,
          taxTotal: cartTotals.taxTotal,
          grandTotal: cartTotals.grandTotal,
        });
        setReceiptModal(true);

        showToast("Bill saved offline — will sync when back online", "info");
        clearCart();
        return;
      }
      const res = await fetch("/api/sales-order/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        const savedBill = json.data?.bill;
        const receiptItems = cart.map((item) => ({
          ...item,
          name: item.name,
          selling_price: item.sellingPrice,
          line_total: calculateGstLine(item, canManageDiscounts).lineTotal,
        }));
        showToast(
          json.data?.message || `Bill ${payload.invoiceNumber} created!`,
        );
        setRecentBills((current) =>
          [savedBill, ...current].filter(Boolean).slice(0, 10),
        );
        setReceiptData({
          bill: {
            ...savedBill,
            customerName: payload.customerName,
            customerMobile,
            publicToken:
              savedBill?.publicToken ?? savedBill?.public_token ?? null,
            subtotal: cartTotals.subtotal,
            discountTotal: cartTotals.discount,
            taxTotal: cartTotals.taxTotal,
            grandTotal: cartTotals.grandTotal,
            paymentMode: payload.paymentMode,
            payments: normalizedPayments,
            createdAt: savedBill?.createdAt || new Date().toISOString(),
          },
          items: receiptItems,
          subtotal: cartTotals.subtotal,
          discount: cartTotals.discount,
          taxTotal: cartTotals.taxTotal,
          grandTotal: cartTotals.grandTotal,
        });
        setReceiptModal(true);
        if (
          savedBill &&
          (savedBill.customerMobile === customerMobile ||
            savedBill.customerName?.toLowerCase() ===
              customerName.toLowerCase())
        )
          setCustomerHistory((current) => [savedBill, ...current].slice(0, 50));
        clearCart();
        loadPOSData();
      } else showToast(json.message || "Failed to create bill", "error");
    } catch (err) {
      console.error("Checkout error:", err);
      if (payload) {
        saveBillOffline(
          payload,
          "Network error. Bill saved locally and will sync automatically.",
        );
      } else {
        showToast("Network error. Bill could not be saved locally.", "error");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all";

  return (
    <MainLayout>
      <div style={{ background: "#f1f5f9", minHeight: "100%" }}>
        {/* ── TOAST ── */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-white text-sm font-bold transition-all ${
              toast.type === "success"
                ? "bg-emerald-500"
                : toast.type === "error"
                  ? "bg-rose-500"
                  : "bg-indigo-500"
            }`}
          >
            <span className="text-base leading-none">
              {toast.type === "success"
                ? "✓"
                : toast.type === "error"
                  ? "✕"
                  : "ℹ"}
            </span>
            {toast.msg}
          </div>
        )}

        {priceVariantOptions.length > 0 && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Select Price
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Same barcode/product has multiple stock-in price batches.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPriceVariantOptions([])}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[60vh] overflow-auto p-3">
                {priceVariantOptions.map((product) => (
                  <button
                    key={product.variantKey || product.id}
                    type="button"
                    onClick={() => {
                      addProduct(product);
                      setPriceVariantOptions([]);
                      setSearch("");
                      searchInputRef.current?.focus();
                    }}
                    className="mb-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-indigo-400 hover:bg-indigo-50/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">
                          {product.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          SKU: {product.sku || "-"} · Barcode:{" "}
                          {product.barcode || "-"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Stock: {product.availableStock}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-black text-indigo-700">
                          {formatCurrency(product.sellingPrice)}
                        </p>
                        <p className="text-xs text-slate-500">
                          MRP {formatCurrency(product.mrp)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TOP BAR ── */}
        <div
          style={{
            background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          }}
          className="rounded-2xl mb-4 px-5 py-3.5 flex items-center justify-between gap-4 shadow-lg shadow-indigo-900/20"
        >
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <div className="md:hidden flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="w-9 h-9 rounded-xl border border-white/20 bg-white/10 text-white flex items-center justify-center active:bg-white/20"
                aria-label="Go back"
                title="Back"
              >
                <i className="ti ti-arrow-left text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="w-9 h-9 rounded-xl border border-white/20 bg-white/10 text-white flex items-center justify-center active:bg-white/20"
                aria-label="Go home"
                title="Home"
              >
                <i className="ti ti-home text-[18px]" />
              </button>
            </div>
            <div>
              <p className="text-indigo-300 text-[10px] font-black tracking-[0.15em] uppercase">
                Point of Sale
              </p>
              <h1 className="text-xl font-black text-white mt-0.5 leading-tight">
                POS Billing
              </h1>
            </div>
            {session?.sessionId ? (
              <div className="hidden sm:flex items-center gap-2 bg-white/10 backdrop-blur rounded-lg px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-sm shadow-emerald-400"></span>
                <span className="text-indigo-100 text-xs font-semibold truncate max-w-[200px]">
                  {session.userName || "POS User"}
                  {session.storeName ? ` · ${session.storeName}` : ""}
                </span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2 bg-rose-500/20 rounded-lg px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0"></span>
                <span className="text-rose-200 text-xs font-semibold">
                  No active session
                </span>
              </div>
            )}
            {/* Offline / Auto-sync status */}
            {isOffline ? (
              <div className="flex items-center gap-1.5 bg-rose-500/25 border border-rose-400/30 rounded-lg px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0 animate-pulse"></span>
                <span className="text-rose-200 text-xs font-bold">OFFLINE</span>
                {pendingQueueCount > 0 && (
                  <span className="text-rose-300 text-[10px] font-semibold">
                    · {pendingQueueCount} pending
                  </span>
                )}
              </div>
            ) : pendingQueueCount > 0 ? (
              <div className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/30 rounded-lg px-3 py-1.5">
                <svg
                  className="w-3 h-3 text-emerald-400 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"
                  />
                </svg>
                <span className="text-emerald-300 text-xs font-semibold">
                  Syncing {pendingQueueCount} bill
                  {pendingQueueCount > 1 ? "s" : ""}…
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {!session?.sessionId ? (
              <button
                onClick={() => setOpenSessionModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-400 hover:bg-indigo-300 text-white font-bold text-sm transition-all shadow-md shadow-indigo-900/30"
              >
                ▶ Open Session
              </button>
            ) : (
              <>
                <button
                  onClick={openCloseSessionModal}
                  className="px-3 py-2 rounded-xl border border-white/20 text-indigo-200 hover:bg-white/10 font-semibold text-xs transition-all"
                >
                  Close Session
                </button>
                <button
                  type="button"
                  onClick={scaleConnected ? disconnectScale : connectScale}
                  className={`px-3 py-2 rounded-xl border font-semibold text-xs transition-all ${
                    scaleConnected
                      ? "border-emerald-300/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                      : "border-white/20 text-indigo-200 hover:bg-white/10"
                  }`}
                  title="Connect USB weighing scale"
                >
                  {scaleConnected
                    ? `Scale ${scaleStatus || formatScaleWeight(scaleWeightKg)}`
                    : "Connect Scale"}
                </button>
                <button
                  onClick={holdCurrentBill}
                  disabled={cart.length === 0}
                  className="px-3 py-2 rounded-xl border border-amber-400/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  ⏸ Hold Bill
                </button>
                <button
                  onClick={createBill}
                  disabled={!canGenerateBill}
                  className={`flex items-center gap-1.5 px-5 py-2 rounded-xl font-black text-sm transition-all ${
                    canGenerateBill
                      ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-900/30"
                      : "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  {isProcessing
                    ? "⟳ Processing…"
                    : `⚡ ${formatCurrency(cartTotals.grandTotal)}`}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_370px]">
          {/* ══ LEFT: PRODUCTS PANEL ══ */}
          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Search strip */}
            <div className="px-4 pt-4 pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-700 tracking-widest uppercase">
                    Products
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    {filteredProducts.length}
                  </span>
                </div>
                {loading && (
                  <span className="text-[10px] text-indigo-500 font-semibold animate-pulse">
                    Syncing…
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                    🔍
                  </span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleBarcode(search);
                      }
                    }}
                    placeholder="Search, type or scan barcode"
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                  title="Open mobile camera scanner"
                >
                  <i className="ti ti-camera text-base" />
                </button>
              </div>
            </div>

            {/* Product Grid */}
            <div
              className="grid flex-1 grid-cols-2 content-start gap-2 overflow-auto p-2 md:grid-cols-3 2xl:grid-cols-4"
              style={{ maxHeight: "62vh", gridAutoRows: "118px" }}
            >
              {loading ? (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                  <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo-500 animate-spin mb-4"></div>
                  <span className="text-sm font-semibold">
                    Loading products…
                  </span>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                  <span className="text-4xl mb-3">📦</span>
                  <span className="text-sm font-semibold">
                    No products found
                  </span>
                  <span className="text-xs mt-1 text-slate-400">
                    Try a different search
                  </span>
                </div>
              ) : (
                filteredProducts.map((product) => (
                  <button
                    key={product.variantKey || product.id}
                    onClick={() => addProduct(product)}
                    disabled={
                      product.availableStock <= 0 && product.expiredStock <= 0
                    }
                    className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border p-2 text-left transition-all group ${
                      product.availableStock > 0
                        ? "border-slate-200 hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-100/60 bg-white cursor-pointer active:scale-[0.98]"
                        : product.expiredStock > 0
                          ? "border-rose-100 bg-rose-50/40 opacity-80 cursor-pointer hover:border-rose-300"
                          : "border-slate-100 bg-slate-50/70 opacity-55 cursor-not-allowed"
                    }`}
                  >
                    {/* Top row: category + stock pill */}
                    <div className="mb-1.5 flex min-h-[18px] min-w-0 items-center justify-between gap-1">
                      <span className="max-w-[58%] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-500">
                        {product.categoryName}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                          product.availableStock > 10
                            ? "bg-emerald-50 text-emerald-700"
                            : product.availableStock > 0
                              ? "bg-amber-50 text-amber-700"
                              : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {product.availableStock > 0
                          ? `${product.availableStock} left`
                          : product.expiredStock > 0
                            ? "Expired"
                            : "OOS"}
                      </span>
                    </div>

                    {/* Product name */}
                    <p
                      className="min-h-[32px] overflow-hidden text-[11px] font-black leading-4 text-slate-800 transition-colors group-hover:text-indigo-700 2xl:text-xs"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {product.name}
                    </p>

                    {/* SKU + Price row */}
                    <div className="mt-auto grid min-h-[34px] grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-slate-50 pt-1.5">
                      <span className="min-w-0 truncate font-mono text-[9px] leading-tight text-slate-400">
                        {product.sku || product.barcode || "-"}
                        {isWeightedUnit(product.unit)
                          ? ` · ${product.unit}`
                          : ""}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-right text-[11px] font-black leading-tight text-rose-700 2xl:text-xs">
                        ₹
                        {toNumber(product.sellingPrice).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ══ RIGHT: ORDER PANEL ══ */}
          <aside className="flex min-w-0 flex-col gap-3">
            {/* ── CART ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-700 tracking-widest uppercase">
                    Cart
                  </span>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      cart.length > 0
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {cart.length}
                  </span>
                </div>
                {cart.length > 0 && (
                  <button
                    onClick={clearCart}
                    className="text-[10px] font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <span className="text-4xl mb-2.5">🛒</span>
                  <span className="text-xs font-bold text-slate-500">
                    Cart is empty
                  </span>
                  <span className="text-[11px] mt-1 text-slate-400">
                    Tap a product to add it
                  </span>
                </div>
              ) : (
                <>
                  <div className="overflow-auto" style={{ maxHeight: "190px" }}>
                    {cart.map((item) => {
                      const itemKey = getCartItemKey(item);
                      const weightedUnit = getWeightedUnitKind(item.unit);
                      const weighted = Boolean(weightedUnit);
                      const isScaleLinked = activeScaleCartKey === itemKey;
                      const qtyStep = weightedUnit === "KG" ? 0.001 : 1;
                      const minQty = weighted ? 0 : 1;
                      return (
                        <div
                          key={itemKey}
                          onClick={() => {
                            if (!weighted) return;
                            activeScaleCartKeyRef.current = itemKey;
                            setActiveScaleCartKey(itemKey);
                          }}
                          className={`border-b border-slate-50 px-2.5 py-2 transition-colors last:border-0 hover:bg-slate-50/50 ${
                            isScaleLinked ? "bg-emerald-50/60" : ""
                          } ${weighted ? "cursor-pointer" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-slate-800 text-xs leading-snug line-clamp-2">
                                {item.name}
                              </p>
                              {isScaleLinked && (
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600">
                                  Live scale sync
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => removeCartItem(itemKey)}
                              className="w-5 h-5 rounded-md bg-rose-50 text-rose-400 hover:bg-rose-500 hover:text-white text-[10px] font-black flex items-center justify-center transition-all shrink-0 mt-0.5"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Qty +/- */}
                            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden shrink-0">
                              <button
                                onClick={() =>
                                  updateCartItem(
                                    itemKey,
                                    "qty",
                                    Math.max(
                                      minQty,
                                      Number((item.qty - qtyStep).toFixed(3)),
                                    ),
                                  )
                                }
                                className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 font-bold text-base transition-colors"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={minQty}
                                step={qtyStep}
                                value={item.qty}
                                onChange={(e) =>
                                  updateCartItem(
                                    itemKey,
                                    "qty",
                                    Math.min(
                                      toNumber(e.target.value, minQty),
                                      item.availableStock,
                                    ),
                                  )
                                }
                                className="w-9 h-7 text-center text-xs font-bold text-slate-900 bg-white border-x border-slate-200 outline-none"
                              />
                              <button
                                onClick={() =>
                                  updateCartItem(
                                    itemKey,
                                    "qty",
                                    Math.min(
                                      Number((item.qty + qtyStep).toFixed(3)),
                                      item.availableStock,
                                    ),
                                  )
                                }
                                className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 font-bold text-base transition-colors"
                              >
                                +
                              </button>
                            </div>
                            {weighted && (
                              <span className="text-[10px] font-bold text-slate-500">
                                {item.qty} {weightedUnit}
                              </span>
                            )}

                            {canManageDiscounts && item.allowDiscountOnPos && (
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <span className="text-[9px] text-slate-400 font-bold shrink-0 uppercase">
                                  Disc
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  value={item.discountAmount}
                                  onChange={(e) =>
                                    updateCartItem(
                                      itemKey,
                                      "discountAmount",
                                      toNumber(e.target.value, 0),
                                    )
                                  }
                                  className="flex-1 min-w-0 rounded-md border border-slate-200 px-1.5 h-7 text-xs text-slate-900 outline-none focus:border-indigo-400 bg-white"
                                />
                              </div>
                            )}

                            <span className="ml-auto font-black text-slate-900 text-xs whitespace-nowrap">
                              {formatCurrency(
                                item.qty * item.sellingPrice -
                                  (canManageDiscounts && item.allowDiscountOnPos
                                    ? toNumber(item.discountAmount)
                                    : 0),
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Totals */}
                  <div className="px-4 py-3 bg-gradient-to-b from-slate-50 to-white border-t border-slate-100 space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Subtotal</span>
                      <span className="font-semibold text-slate-700">
                        {formatCurrency(cartTotals.subtotal)}
                      </span>
                    </div>
                    {cartTotals.discount > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600">
                        <span>Discount</span>
                        <span className="font-semibold">
                          −{formatCurrency(cartTotals.discount)}
                        </span>
                      </div>
                    )}
                    {cartTotals.taxTotal > 0 && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>GST</span>
                        <span className="font-semibold text-slate-700">
                          {formatCurrency(cartTotals.taxTotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                      <span className="text-sm font-black text-slate-800">
                        Total
                      </span>
                      <span className="text-xl font-black text-indigo-700">
                        {formatCurrency(cartTotals.grandTotal)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── PAYMENT ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <span className="text-xs font-black text-slate-700 tracking-widest uppercase">
                  Payment
                </span>
              </div>
              <div className="space-y-2 p-2.5">
                {/* Customer fields */}
                <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className={inputCls}
                    style={{ fontSize: "12px" }}
                  />
                  <div>
                    <input
                      type="tel"
                      value={customerMobile}
                      onChange={(e) => {
                        const digits = String(e.target.value)
                          .replace(/\D/g, "")
                          .slice(0, 10);
                        setCustomerMobile(digits);
                        if (digits.length === 10) checkForHeldBills(digits);
                      }}
                      placeholder="Mobile (10 digits) *"
                      maxLength="10"
                      required
                      className={`${inputCls} ${cart.length > 0 && !customerMobile.trim() ? "border-rose-300 bg-rose-50/40" : ""}`}
                      style={{ fontSize: "12px" }}
                    />
                    {customerMobile &&
                      !validatePhoneNumber(customerMobile).isValid && (
                        <p className="text-[10px] text-rose-500 mt-0.5 px-1">
                          {validatePhoneNumber(customerMobile).error}
                        </p>
                      )}
                  </div>
                </div>

                {/* View history */}
                <button
                  onClick={loadCustomerHistory}
                  className="w-full text-xs font-semibold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-xl py-2 transition-colors"
                >
                  📋 View Customer History
                </button>

                <div>
                  <p className="text-[10px] font-black text-slate-400 tracking-widest uppercase mb-1.5">
                    Payment Method Amounts
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FIXED_PAYMENT_METHODS.map((method) => {
                      const paymentRow = payments.find(
                        (payment) => payment.method === method.method,
                      ) || { method: method.method, amount: "" };
                      return (
                        <div
                          key={method.method}
                          className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <i
                                className={`ti ${method.icon} text-base text-slate-600`}
                              />
                              <span className="text-xs font-bold text-slate-800">
                                {method.label}
                              </span>
                            </div>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={paymentRow.amount}
                            onChange={(e) => {
                              const nextAmount = e.target.value;
                              setPayments((current) =>
                                current.map((payment) =>
                                  payment.method === method.method
                                    ? { ...payment, amount: nextAmount }
                                    : payment,
                                ),
                              );
                            }}
                            placeholder="Amount"
                            className={inputCls}
                            style={{ fontSize: "12px" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div
                    className={`text-[11px] font-bold ${isPaymentBalanced ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    Paid {formatCurrency(paidTotal)} / Balance{" "}
                    {formatCurrency(paymentBalance)}
                  </div>
                </div>

                {/* Order discount */}
                {canApplyOrderDiscount && (
                  <div>
                    <label className="text-[10px] font-black text-slate-400 tracking-widest uppercase block mb-1">
                      Order Discount
                    </label>
                    <input
                      type="number"
                      value={orderDiscount}
                      onChange={(e) => setOrderDiscount(e.target.value)}
                      placeholder="0"
                      className={inputCls}
                      style={{ fontSize: "12px" }}
                    />
                  </div>
                )}

                {/* Round off */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 tracking-widest uppercase block mb-1">
                    Round Off
                  </label>
                  <input
                    type="number"
                    value={roundOff}
                    readOnly
                    className={`${inputCls} cursor-not-allowed bg-slate-100`}
                    style={{ fontSize: "12px" }}
                  />
                </div>

                {/* Generate Bill */}
                <button
                  onClick={createBill}
                  disabled={!canGenerateBill}
                  className={`w-full py-3.5 rounded-xl font-black text-sm transition-all ${
                    canGenerateBill
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-200 active:scale-[0.99]"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  {!session?.sessionId
                    ? "🔒 Open Session First"
                    : isProcessing
                      ? "⟳ Generating…"
                      : `⚡ Generate Bill · ${formatCurrency(cartTotals.grandTotal)}`}
                </button>

                {/* Hold Bill */}
                <button
                  onClick={holdCurrentBill}
                  disabled={cart.length === 0}
                  className="w-full py-2 rounded-xl font-bold text-xs border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  ⏸ Hold Bill
                </button>
              </div>
            </div>

            {/* ── HELD BILLS ── */}
            {heldBills.length > 0 && (
              <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-100 flex items-center justify-between bg-amber-50/50">
                  <span className="text-xs font-black text-amber-800 tracking-widest uppercase">
                    Held Bills
                  </span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {heldBills.length}
                  </span>
                </div>
                <div className="max-h-52 overflow-auto divide-y divide-slate-50">
                  {heldBills.map((heldBill, idx) => (
                    <div
                      key={heldBill.id || idx}
                      className="px-3 py-2.5 hover:bg-amber-50/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-xs truncate">
                            {heldBill.customerName || "Walk-in"}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {(heldBill.cart || []).length} items
                            {heldBill.customerMobile
                              ? ` · ${heldBill.customerMobile}`
                              : ""}
                          </p>
                        </div>
                        <span className="font-black text-amber-700 text-xs shrink-0">
                          {formatCurrency(heldBill.totals?.grandTotal || 0)}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => resumeHeldBill(heldBill)}
                          className="flex-1 text-[10px] font-bold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 rounded-lg py-1.5 transition-colors"
                        >
                          Resume
                        </button>
                        <button
                          onClick={() => removeHeldBill(heldBill.id)}
                          className="text-[10px] font-bold text-rose-600 border border-rose-200 bg-white hover:bg-rose-50 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── RECENT BILLS ── */}
            {recentBills.length > 0 && (
              <div
                className={`bg-white rounded-2xl shadow-sm overflow-hidden ${
                  recentBills.some((b) => b.isOffline)
                    ? "border border-amber-200"
                    : "border border-slate-200"
                }`}
              >
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-700 tracking-widest uppercase">
                      Recent Bills
                    </span>
                    {recentBills.some((b) => b.isOffline) && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">
                        {recentBills.filter((b) => b.isOffline).length} PENDING
                        SYNC
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {recentBills.length}
                    </span>
                  </div>
                </div>
                <div className="max-h-44 overflow-auto divide-y divide-slate-50">
                  {recentBills.map((bill, idx) => (
                    <div
                      key={bill.id || bill.billNumber || idx}
                      className={`px-3 py-2.5 transition-colors ${
                        bill.isOffline
                          ? "bg-amber-50/40 hover:bg-amber-50"
                          : "hover:bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-bold text-slate-900 text-xs truncate">
                              {bill.billNumber || `Bill ${idx + 1}`}
                            </p>
                            {bill.isOffline && (
                              <span className="text-[8px] font-black px-1 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0 uppercase tracking-wide">
                                Offline
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                            {bill.customerName || "Walk-in"}
                            {bill.customerMobile
                              ? ` · ${bill.customerMobile}`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`font-black text-xs ${bill.isOffline ? "text-amber-700" : "text-indigo-600"}`}
                          >
                            {formatCurrency(bill.grandTotal)}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {formatPaymentBreakup(
                              bill.payments,
                              bill.paymentMode || "cash",
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (bill.isOffline) {
                            // For offline bills, reconstruct receipt from stored data
                            setReceiptData({
                              bill: {
                                ...bill,
                                publicToken: null,
                              },
                              items: [],
                              subtotal: bill.subtotal || bill.grandTotal || 0,
                              discount: bill.discountTotal || 0,
                              taxTotal: bill.taxTotal || 0,
                              grandTotal: bill.grandTotal || 0,
                            });
                            setReceiptModal(true);
                          } else {
                            openReceiptFromBill(bill);
                          }
                        }}
                        className={`w-full text-[10px] font-bold rounded-lg py-1.5 transition-colors ${
                          bill.isOffline
                            ? "text-amber-700 border border-amber-200 bg-white hover:bg-amber-50"
                            : "text-indigo-600 border border-indigo-100 bg-white hover:bg-indigo-50"
                        }`}
                      >
                        {bill.isOffline
                          ? "🖨 Print Offline Receipt"
                          : "View Receipt"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* ══════════════════════ MODALS ══════════════════════ */}

        {/* ── Receipt Modal ── */}
        {receiptModal && receiptData && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl max-h-[92vh] overflow-auto">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Bill Receipt
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {receiptData.bill?.billNumber ||
                      receiptData.bill?.bill_number ||
                      receiptData.bill?.invoiceNumber}
                  </p>
                </div>
                <button
                  onClick={() => setReceiptModal(false)}
                  className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors"
                >
                  ✕ Close
                </button>
              </div>

              <div className="px-5 py-4 text-sm text-slate-800">
                {/* Offline bill notice */}
                {receiptData.bill?.isOffline && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <span className="text-amber-500 text-base shrink-0">⚠</span>
                    <div>
                      <p className="text-xs font-black text-amber-800">
                        Offline Bill — Pending Server Sync
                      </p>
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        This bill will be confirmed & stock updated once
                        internet is restored.
                      </p>
                    </div>
                  </div>
                )}
                <div className="mb-3 flex flex-col items-center text-center">
                  <img
                    src="/buyzaar-sync-logo.svg"
                    alt="Buyzaar Sync"
                    className="h-12 w-auto object-contain"
                  />
                  <p className="text-xs text-slate-500">
                    {receiptData.bill?.isOffline
                      ? "OFFLINE RECEIPT"
                      : "GST Invoice / POS Receipt"}
                  </p>
                </div>
                <div className="my-3 border-t border-dashed border-slate-300" />
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-500">
                      Bill No.
                    </span>
                    <span className="font-bold text-slate-900 text-right">
                      {receiptData.bill?.billNumber ||
                        receiptData.bill?.bill_number ||
                        receiptData.bill?.invoiceNumber ||
                        "-"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-500">
                      Date & Time
                    </span>
                    <span className="font-bold text-slate-900 text-right">
                      {formatReceiptDateTime(
                        receiptData.bill?.createdAt ||
                          receiptData.bill?.created_at,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-500">
                      Customer
                    </span>
                    <span className="font-bold text-slate-900 text-right">
                      {receiptData.bill?.customerName ||
                        receiptData.bill?.customer_name ||
                        "Walk-in Customer"}
                    </span>
                  </div>
                  {(receiptData.bill?.customerMobile ||
                    receiptData.bill?.customer_mobile) && (
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold text-slate-500">
                        Mobile
                      </span>
                      <span className="font-bold text-slate-900">
                        {receiptData.bill?.customerMobile ||
                          receiptData.bill?.customer_mobile}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-500">
                      Payment
                    </span>
                    <span className="font-bold text-slate-900 text-right">
                      {formatPaymentBreakup(
                        getReceiptPayments(receiptData),
                        receiptData.bill?.paymentMode ||
                          receiptData.bill?.payment_mode ||
                          "cash",
                      )}
                    </span>
                  </div>
                </div>
                <div className="my-3 border-t border-dashed border-slate-300" />
                <div className="space-y-2">
                  {(receiptData.items || []).map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="flex justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          {item.name || item.product_name || "Product"}
                        </p>
                        <p className="text-slate-500 mt-0.5">
                          Qty {toNumber(item.qty, 1)} ×{" "}
                          {formatCurrency(
                            item.selling_price || item.sellingPrice,
                          )}
                        </p>
                      </div>
                      <p className="font-black text-slate-900 shrink-0">
                        {formatCurrency(
                          item.line_total ||
                            toNumber(item.qty, 1) *
                              toNumber(item.selling_price || item.sellingPrice),
                        )}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="my-3 border-t border-dashed border-slate-300" />
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <strong className="text-slate-900">
                      {formatCurrency(
                        receiptData.bill?.subtotal || receiptData.subtotal || 0,
                      )}
                    </strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Discount</span>
                    <strong className="text-slate-900">
                      {formatCurrency(
                        receiptData.bill?.discount_total ||
                          receiptData.bill?.discountTotal ||
                          receiptData.discount ||
                          0,
                      )}
                    </strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>GST</span>
                    <strong className="text-slate-900">
                      {formatCurrency(
                        receiptData.bill?.tax_total ||
                          receiptData.bill?.totalTax ||
                          receiptData.taxTotal ||
                          0,
                      )}
                    </strong>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200 text-base font-black text-indigo-700">
                    <span>Total</span>
                    <span>
                      {formatCurrency(
                        receiptData.bill?.grand_total ||
                          receiptData.bill?.grandTotal ||
                          receiptData.grandTotal ||
                          0,
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {receiptQR && (
                <div className="flex items-center gap-4 mx-5 mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <img
                    src={receiptQR}
                    alt="Invoice QR"
                    className="w-20 h-20 rounded-xl border border-slate-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-xs">
                      Digital Invoice
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      Scan to view, download or print this invoice anytime.
                    </p>
                    {(receiptData?.bill?.publicToken ||
                      receiptData?.bill?.public_token) && (
                      <a
                        href={getInvoiceURL(
                          receiptData.bill.publicToken ||
                            receiptData.bill.public_token,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-indigo-600 font-bold hover:underline mt-1 inline-block"
                      >
                        Open invoice →
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="px-5 pb-5">
                <button
                  onClick={() => printReceipt()}
                  className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 px-4 py-3 font-black text-sm text-white transition-colors"
                >
                  🖨 Print Receipt
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Open Session Modal ── */}
        {scannerOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Scan Barcode
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {scannerStatus || "Camera scanner"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(false)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700"
                >
                  Close
                </button>
              </div>
              <div className="bg-slate-950">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-72 w-full object-cover"
                />
              </div>
              {scannerError && (
                <div className="px-4 py-3 text-xs font-semibold text-rose-600">
                  {scannerError}
                </div>
              )}
              <div className="px-4 pb-4 pt-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setScannerOpen(false);
                      handleBarcode(search);
                    }
                  }}
                  placeholder="Or enter/scan barcode"
                  className={inputClassName}
                />
              </div>
            </div>
          </div>
        )}

        {openSessionModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">
                Open Session
              </h3>
              <div className="space-y-3">
                <input
                  type="number"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  placeholder="Opening cash"
                  className={inputClassName}
                />
                <p className="text-xs font-medium text-slate-500">
                  Enter the opening float physically handed to this employee
                  drawer. Use 0 if no float is assigned.
                </p>
                <input
                  type="text"
                  value={counterName}
                  onChange={(e) => setCounterName(e.target.value)}
                  placeholder="Counter name"
                  className={inputClassName}
                />
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900"
                >
                  <option value="">Select store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOpenSessionModal(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={openSession}
                    disabled={isProcessing}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm disabled:opacity-50 transition-colors"
                  >
                    {isProcessing ? "Opening…" : "Open Session"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Close Session Modal ── */}
        {closeSessionModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[92vh] overflow-auto">
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="text-base font-black text-slate-900">
                  Close POS Session
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Review today's summary before closing the session.
                </p>
              </div>
              <div className="px-6 py-5 space-y-4">
                {closingLoading ? (
                  <div className="flex items-center justify-center gap-3 py-6 text-slate-500">
                    <div className="w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></div>
                    <span className="text-sm font-semibold">
                      Loading session summary…
                    </span>
                  </div>
                ) : closingSummary?.totals ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black text-slate-400 tracking-widest uppercase mb-3">
                      Session Summary
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <ClosingStat
                        label="Opening Cash"
                        value={formatCurrency(
                          closingSummary.totals.openingCash,
                        )}
                      />
                      <ClosingStat
                        label="Total Sale"
                        value={formatCurrency(closingSummary.totals.grossSales)}
                      />
                      <ClosingStat
                        label="Cash Sale"
                        value={formatCurrency(closingSummary.totals.cashSales)}
                      />
                      <ClosingStat
                        label="Withdrawn"
                        value={formatCurrency(
                          closingSummary.totals.cashWithdrawals,
                        )}
                      />
                      <ClosingStat
                        label="Card Sale"
                        value={formatCurrency(closingSummary.totals.cardSales)}
                      />
                      <ClosingStat
                        label="UPI Sale"
                        value={formatCurrency(closingSummary.totals.upiSales)}
                      />
                      <ClosingStat
                        label="Paid Total"
                        value={formatCurrency(closingSummary.totals.paidTotal)}
                      />
                      <ClosingStat
                        label="Bills"
                        value={closingSummary.totals.billCount || 0}
                      />
                      <ClosingStat
                        label="Expected Cash"
                        value={formatCurrency(
                          closingSummary.totals.expectedCash,
                        )}
                        strong
                      />
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className="text-[10px] font-black text-slate-400 tracking-widest uppercase block mb-1.5">
                    Counted Cash / Handover Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-lg font-black text-emerald-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                    This is the cash the employee is handing to manager.
                    Variance is tracked against expected cash.
                  </p>
                </div>
                {!canCloseSessionNow && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    This session can only be closed after 9:00 PM IST.
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-black text-slate-400 tracking-widest uppercase block mb-1.5">
                    Remarks (optional)
                  </label>
                  <textarea
                    value={closingRemarks}
                    onChange={(e) => setClosingRemarks(e.target.value)}
                    placeholder="Any notes about today's session…"
                    rows="2"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setCloseSessionModal(false);
                      setClosingSummary(null);
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={closeSession}
                    disabled={
                      isProcessing || closingLoading || !canCloseSessionNow
                    }
                    className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm disabled:opacity-50 transition-colors"
                  >
                    {isProcessing
                      ? "Closing…"
                      : canCloseSessionNow
                        ? "Close Session"
                        : "Available after 9 PM"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Hold Bill Detection Modal ── */}
        {holdDetectModal && detectedHeldBills.length > 0 && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-100 px-5 py-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl shrink-0">
                  ⏸
                </div>
                <div className="min-w-0">
                  <p className="font-black text-slate-900 text-sm">
                    Held Bill Found
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {detectedHeldBills.length === 1
                      ? `1 held bill for ${detectedHeldBills[0].customerMobile}`
                      : `${detectedHeldBills.length} held bills for ${detectedHeldBills[0].customerMobile}`}
                  </p>
                </div>
              </div>

              <div className="p-4 space-y-2 max-h-72 overflow-auto">
                {detectedHeldBills.map((heldBill) => (
                  <button
                    key={heldBill.id}
                    type="button"
                    onClick={() => holdCurrentAndResume(heldBill)}
                    className="w-full text-left rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3 hover:bg-amber-100 hover:border-amber-400 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-sm truncate">
                          {heldBill.customerName || "Walk-in Customer"}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {(heldBill.cart || []).length} item
                          {(heldBill.cart || []).length !== 1 ? "s" : ""}
                          {heldBill.heldAt
                            ? ` · ${new Date(heldBill.heldAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-amber-700 text-sm">
                          {formatCurrency(heldBill.totals?.grandTotal || 0)}
                        </p>
                        <p className="text-[10px] text-indigo-600 font-bold group-hover:underline mt-0.5">
                          Resume →
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {cart.length > 0 && (
                <div className="mx-4 mb-3 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 font-semibold">
                  Your current cart ({cart.length} item
                  {cart.length !== 1 ? "s" : ""}) will be auto-held when you
                  resume.
                </div>
              )}

              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => {
                    setHoldDetectModal(false);
                    setDetectedHeldBills([]);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Start Fresh Billing
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Customer History Modal ── */}
        {customerHistoryModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[85vh] overflow-auto">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Customer History
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {customerName || customerMobile}
                  </p>
                </div>
                <button
                  onClick={() => setCustomerHistoryModal(false)}
                  className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors"
                >
                  ✕ Close
                </button>
              </div>

              <div className="p-5">
                {customerHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <span className="text-4xl mb-3">🔍</span>
                    <span className="text-sm font-semibold">
                      No history found
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {customerHistory.map((bill, idx) => (
                      <button
                        key={bill.id || idx}
                        type="button"
                        onClick={() => selectCustomerFromHistory(bill)}
                        className="text-left rounded-xl border border-slate-200 p-4 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50 transition-all"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-slate-900 text-sm">
                              {bill.billNumber || "Bill #"}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {new Date(bill.createdAt).toLocaleDateString(
                                "en-IN",
                              )}
                            </p>
                            <p className="text-xs text-slate-600 mt-1">
                              {bill.customerName || "Walk-in"}
                              {bill.customerMobile
                                ? ` · ${bill.customerMobile}`
                                : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="font-black text-indigo-600 text-sm">
                              {formatCurrency(bill.grandTotal)}
                            </span>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {formatPaymentBreakup(
                                bill.payments,
                                bill.paymentMode,
                              )}
                            </p>
                          </div>
                        </div>
                        {bill.itemCount && (
                          <p className="text-[11px] text-slate-500 mt-2">
                            {bill.itemCount} items
                          </p>
                        )}
                        <p className="text-[11px] font-bold text-indigo-600 mt-2">
                          ↑ Use this customer
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

function ClosingStat({ label, value, strong = false }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${strong ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"}`}
    >
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p
        className={`text-sm ${strong ? "font-black text-indigo-700" : "font-bold text-slate-800"}`}
      >
        {value}
      </p>
    </div>
  );
}
