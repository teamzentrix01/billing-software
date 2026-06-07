"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

function code128Values(text) {
  const safe = String(text || "").replace(/[^\x20-\x7f]/g, "");
  const values = [104];
  for (const char of safe) values.push(char.charCodeAt(0) - 32);
  const checksum =
    values.reduce(
      (sum, value, index) => sum + value * (index === 0 ? 1 : index),
      0,
    ) % 103;
  values.push(checksum, 106);
  return values;
}

function BarcodeSvg({ value }) {
  const bars = [];
  let x = 0;
  for (const code of code128Values(value)) {
    const pattern = CODE128_PATTERNS[code];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${x} 46`}
      preserveAspectRatio="none"
      className="h-11 w-full"
    >
      <rect width={x} height="46" fill="white" />
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={bar.x}
          y="0"
          width={bar.width}
          height="46"
          fill="black"
        />
      ))}
    </svg>
  );
}

function money(value) {
  const num = Number(value || 0);
  return `Rs. ${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function Label({ product, widthMm, heightMm }) {
  const price = Number(product.selling_price || product.mrp || 0);
  return (
    <div
      className="barcode-label overflow-hidden border border-dashed border-slate-300 bg-white p-1.5 text-slate-950"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[9px] font-bold uppercase leading-tight">
            {product.name}
          </div>
          <div className="truncate text-[7px] leading-tight text-slate-600">
            {[product.brand_name, product.unit].filter(Boolean).join(" | ") ||
              "Product"}
          </div>
        </div>
        <div className="shrink-0 text-right text-[9px] font-bold">
          {money(price)}
        </div>
      </div>
      <div className="mt-1">
        <BarcodeSvg value={product.barcode} />
      </div>
      <div className="mt-0.5 flex justify-between gap-1 text-[7px] leading-none text-slate-700">
        <span className="truncate">{product.barcode}</span>
        <span className="truncate">
          {product.sku || product.product_id || ""}
        </span>
      </div>
    </div>
  );
}

export default function ProductBarcodePrintPage() {
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids") || "";
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copies, setCopies] = useState(1);
  const [widthMm, setWidthMm] = useState(50);
  const [heightMm, setHeightMm] = useState(25);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/catalog/products/barcodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const json = await response.json();
        if (!json.success)
          throw new Error(json.message || "Unable to load barcode labels");
        if (!ignore) setProducts(json.data?.records || []);
      } catch (err) {
        if (!ignore) setError(err.message || "Unable to load barcode labels");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [ids]);

  const labels = useMemo(() => {
    const count = Math.max(1, Math.min(200, Number(copies) || 1));
    return products.flatMap((product) =>
      Array.from({ length: count }, (_, index) => ({
        product,
        key: `${product.id}-${index}`,
      })),
    );
  }, [copies, products]);

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-sm text-slate-800">
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .print-sheet {
            padding: 0 !important;
            background: white !important;
          }
          .barcode-label {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-6xl flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold text-slate-950">
            Barcode Labels
          </h1>
          <p className="text-xs text-slate-500">
            Auto-generated barcodes are saved to product master before printing.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Copies
            </span>
            <input
              type="number"
              min="1"
              max="200"
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
              className="w-20 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Width mm
            </span>
            <input
              type="number"
              min="25"
              max="100"
              value={widthMm}
              onChange={(e) => setWidthMm(e.target.value)}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Height mm
            </span>
            <input
              type="number"
              min="15"
              max="60"
              value={heightMm}
              onChange={(e) => setHeightMm(e.target.value)}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            onClick={() => window.print()}
            disabled={!products.length}
            className="rounded-lg bg-red-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            Print
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mx-auto max-w-6xl rounded-lg bg-white p-8 text-center text-slate-500">
          Loading labels...
        </div>
      ) : error ? (
        <div className="mx-auto max-w-6xl rounded-lg bg-white p-8 text-center text-red-600">
          {error}
        </div>
      ) : (
        <div className="print-sheet mx-auto flex max-w-6xl flex-wrap content-start gap-2 bg-white p-4 shadow-sm">
          {labels.map(({ product, key }) => (
            <Label
              key={key}
              product={product}
              widthMm={widthMm}
              heightMm={heightMm}
            />
          ))}
        </div>
      )}
    </div>
  );
}
