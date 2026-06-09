'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CatalogDashboard() {
  const router = useRouter();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    fetch('/api/catalog/dashboard')
      .then(r => r.json())
      .then(json => { if (json.success) setData(json.data); })
      .finally(() => setLoading(false));
  }, []);

  const stats    = data?.stats || {};
  const products = data?.products || [];

  const tabs = [
    { label: 'All',             count: stats.total_products  || 0 },
    { label: 'Needs attention', count: stats.needs_attention || 0, alert: true },
    { label: 'Missing price',   count: stats.missing_price   || 0, alert: true },
    { label: 'Duplicate SKUs',  count: stats.duplicate_skus  || 0, alert: true },
    { label: 'Below cost',      count: stats.below_cost      || 0, alert: true },
    { label: 'HSN missing',     count: stats.hsn_missing    || 0, alert: true },
    { label: 'Out of stock',    count: stats.out_of_stock   || 0 },
    { label: 'No image',        count: stats.no_image       || 0, alert: true },
  ];

  const filteredProducts = products.filter(p => {
    if (activeTab === 'No image')        return p.no_image;
    if (activeTab === 'HSN missing')     return p.hsn_missing;
    if (activeTab === 'Missing price')    return p.missing_price;
    if (activeTab === 'Duplicate SKUs')   return p.duplicate_sku;
    if (activeTab === 'Below cost')      return p.below_cost;
    if (activeTab === 'Out of stock')    return p.stock === 0;
    if (activeTab === 'Needs attention') return p.no_image || p.hsn_missing || p.missing_price || p.duplicate_sku || p.below_cost;
    return true;
  }).filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (id) =>
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const toggleAll = () =>
    setSelected(selected.length === filteredProducts.length ? [] : filteredProducts.map(p => p.id));

  const health = stats.health_score ?? 100;
  const circumference = 2 * Math.PI * 34;
  const dashOffset = circumference - (health / 100) * circumference;
  const healthColor = health >= 80 ? '#539D62' : health >= 50 ? '#f59e0b' : '#dc2626';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
              strokeDasharray="32" strokeDashoffset="12"/>
          </svg>
          Loading catalog...
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans text-sm">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <span className="text-blue-500 cursor-pointer hover:underline">Home</span>
        <span>›</span>
        <span className="text-blue-500 cursor-pointer hover:underline">Catalog</span>
        <span>›</span>
        <span className="text-gray-700 font-medium">Catalog Dashboard</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catalog</h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats.total_products || 0} products · {stats.total_categories || 0} categories · {stats.total_brands || 0} brands
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
              <path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M3 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Bulk operations
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={() => router.push('/catalog/products/create')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            <span className="text-base leading-none">+</span>
            New product
          </button>
        </div>
      </div>

      {/* Catalog Health Card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 flex items-center gap-6">
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="6"/>
              <circle cx="40" cy="40" r="34" fill="none"
                stroke={healthColor} strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] text-gray-400 font-medium leading-none">CATALOG</span>
              <span className="text-[10px] text-gray-400 leading-none">HEALTH</span>
            </div>
          </div>
          <div className="mt-1 text-center">
            <span className="text-2xl font-bold text-gray-900">{health}</span>
            <span className="text-sm text-gray-400">/100</span>
            <p className="text-[10px] text-gray-400 mt-0.5">Last scanned now</p>
          </div>
        </div>

        <div className="w-px h-20 bg-gray-100 flex-shrink-0"/>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-gray-800">What's hurting your catalog</span>
            <span className="ml-auto text-[11px] text-gray-400">Scanned {stats.total_products || 0} products</span>
          </div>
          <div className="space-y-2">
            {stats.hsn_missing > 0 && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <div className="w-5 h-5 rounded bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-gray-800">
                    HSN + GST missing on {stats.hsn_missing} items
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Auto-fill HSN codes from product names; review before saving for clean GST reports.
                  </p>
                </div>
              </div>
            )}
            {stats.no_image > 0 && (
              <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3">
                <div className="w-5 h-5 rounded bg-yellow-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M6 4v4M6 9.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-gray-800">
                    {stats.no_image} products missing images
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Add product images to improve customer experience in app and eStore.
                  </p>
                </div>
              </div>
            )}
            {!stats.hsn_missing && !stats.no_image && (
              <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                <div className="w-5 h-5 rounded bg-green-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <p className="text-[13px] font-semibold text-gray-800">Your catalog looks great! No issues found.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button key={tab.label} onClick={() => setActiveTab(tab.label)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium whitespace-nowrap transition-colors flex-shrink-0
              ${activeTab === tab.label ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {tab.label}
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md
              ${activeTab === tab.label
                ? 'bg-white text-gray-900'
                : tab.alert && tab.count > 0
                  ? 'bg-red-100 text-red-600'
                  : 'bg-gray-100 text-gray-500'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 flex-1 bg-gray-50 rounded-lg px-3 py-2">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M15 15l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input type="text" placeholder="Search by name, barcode, SKU, HSN..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder-gray-400"/>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox"
                    checked={selected.length === filteredProducts.length && filteredProducts.length > 0}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"/>
                </th>
                {['PRODUCT','CATEGORY','MRP','SELLING','COST','MARGIN','STOCK','FLAGS'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-gray-400">No products found</td>
                </tr>
              ) : filteredProducts.map((p, idx) => (
                <tr key={p.id}
                  className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors
                    ${selected.includes(p.id) ? 'bg-blue-50/50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.includes(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer"/>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {p.image_url
                          ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover"/>
                          : <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="none">
                              <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                              <path d="M2 13l4-4 3 3 3-3 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                            </svg>
                        }
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-gray-800 leading-tight">{p.name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{p.brand || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                      {p.category || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-gray-800">
                    {p.mrp ? `₹${p.mrp}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-red-700">
                    {p.selling_price ? `₹${p.selling_price}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-gray-600">
                    {p.cost ? `₹${p.cost}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[13px] font-semibold ${p.margin > 50 ? 'text-green-600' : 'text-gray-700'}`}>
                      {p.margin ?? 0}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-gray-500">
                    {p.stock > 0 ? p.stock : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {p.no_image && (
                        <span className="text-[11px] font-medium bg-red-50 text-red-500 px-2 py-0.5 rounded-lg">No image</span>
                      )}
                      {p.hsn_missing && (
                        <span className="text-[11px] font-medium bg-orange-50 text-orange-500 px-2 py-0.5 rounded-lg">HSN missing</span>
                      )}
                      {p.missing_price && (
                        <span className="text-[11px] font-medium bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-lg">Missing price</span>
                      )}
                      {p.duplicate_sku && (
                        <span className="text-[11px] font-medium bg-purple-50 text-purple-600 px-2 py-0.5 rounded-lg">Duplicate SKU</span>
                      )}
                      {p.below_cost && (
                        <span className="text-[11px] font-medium bg-pink-50 text-pink-600 px-2 py-0.5 rounded-lg">Below cost</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100">
          <p className="text-[12px] text-gray-400">
            Showing {filteredProducts.length} of {stats.total_products || 0} products
          </p>
        </div>
      </div>
    </div>
  );
}
