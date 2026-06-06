'use client';

import { useState } from 'react';
import MainLayout from '@/components/MainLayout';

const products = [
  { id: 1, name: 'AMUL COW GHEE 1 LTR TETRA (RS. 645)', brand: 'AMUL',    category: 'FMCG-FOOD', price: 645,  cost: 585, margin: 10,  stock: null, flags: ['No image'] },
  { id: 2, name: 'AMUL GHEE 1 LTR RT TETRA (MRP 610)',  brand: 'AMUL',    category: 'FMCG-FOOD', price: 610,  cost: 555, margin: 10,  stock: null, flags: ['No image'] },
  { id: 3, name: 'BABUJI CHANA 200GM (MRP-80)',          brand: 'Babu Ji', category: 'FMCG-FOOD', price: 80,   cost: 34,  margin: 135, stock: null, flags: ['No image'] },
  { id: 4, name: 'DIET MIX 300GM (MRP-129) 5%',         brand: 'Babu Ji', category: 'FMCG-FOOD', price: 129,  cost: 55,  margin: 134, stock: null, flags: ['No image'] },
  { id: 5, name: 'FORTUNE RICE BRAN OIL 1LTR',          brand: 'Fortune', category: 'FMCG-FOOD', price: 180,  cost: 160, margin: 13,  stock: 24,   flags: [] },
  { id: 6, name: 'TATA SALT 1KG IODIZED',               brand: 'TATA',    category: 'FMCG-FOOD', price: 22,   cost: 18,  margin: 22,  stock: 50,   flags: [] },
];

const tabs = [
  { label: 'All',              count: 10, active: true },
  { label: 'Needs attention',  count: 10, alert: true },
  { label: 'Missing price',    count: 0 },
  { label: 'Duplicate SKUs',   count: 0 },
  { label: 'Below cost',       count: 0 },
  { label: 'HSN missing',      count: 1, alert: true },
  { label: 'Out of stock',     count: 0 },
  { label: 'No image',         count: 9, alert: true },
];

export default function CatalogDashboard() {
  const [activeTab, setActiveTab] = useState('All');
  const [viewMode, setViewMode] = useState('table');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);

  const toggleSelect = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  const toggleAll = () =>
    setSelected(selected.length === products.length ? [] : products.map((p) => p.id));

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <MainLayout>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <span className="hover:text-blue-600 cursor-pointer">Home</span>
        <i className="ti ti-chevron-right text-[12px]" />
        <span className="hover:text-blue-600 cursor-pointer">Catalog</span>
        <i className="ti ti-chevron-right text-[12px]" />
        <span className="text-gray-900 font-medium">Catalog Dashboard</span>
      </div>

      {/* Page Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catalog</h1>
          <p className="text-sm text-gray-500 mt-1">
            10 products · 2 categories · 5 brands
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <i className="ti ti-upload text-[16px]" />
            Bulk operations
            <i className="ti ti-chevron-down text-[12px]" />
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">
            <i className="ti ti-plus text-[16px]" />
            New product
          </button>
        </div>
      </div>

      {/* Catalog Health Card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 flex items-center gap-6">
        {/* Score Circle */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="6" />
              <circle
                cx="40" cy="40" r="34" fill="none"
                stroke="#539D62" strokeWidth="6"
                strokeDasharray="213.6"
                strokeDashoffset="0"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] text-gray-400 font-medium leading-none">CATALOG</span>
              <span className="text-[10px] text-gray-400 leading-none">HEALTH</span>
            </div>
          </div>
          <div className="mt-1 text-center">
            <span className="text-2xl font-bold text-gray-900">100</span>
            <span className="text-sm text-gray-400">/100</span>
            <p className="text-[10px] text-gray-400 mt-0.5">Last scanned now</p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-20 bg-gray-100 flex-shrink-0" />

        {/* QB Intelligence */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-2 py-0.5 rounded tracking-wide">
              + QB INTELLIGENCE
            </span>
            <span className="text-sm font-semibold text-gray-800">
              What's hurting your catalog
            </span>
            <span className="ml-auto text-[11px] text-gray-400">Scanned 10 products</span>
          </div>
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <div className="w-5 h-5 rounded bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <i className="ti ti-check text-white text-[11px]" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-gray-800">
                HSN + GST missing on 1 items
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Auto-fill HSN codes from product names; review before saving for clean GST reports.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(tab.label)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium whitespace-nowrap transition-colors flex-shrink-0
              ${activeTab === tab.label
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
              }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md
                ${activeTab === tab.label
                  ? 'bg-white text-gray-900'
                  : tab.alert && tab.count > 0
                    ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search + Filters bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 flex-1 bg-gray-50 rounded-lg px-3 py-2">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search by name, barcode, SKU, HSN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder-gray-400"
            />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-[12.5px] text-gray-600 hover:bg-gray-50 transition-colors">
            <i className="ti ti-filter text-[14px] text-blue-500" />
            Category
            <i className="ti ti-chevron-down text-[11px]" />
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-[12.5px] text-gray-600 hover:bg-gray-50 transition-colors">
            <i className="ti ti-filter text-[14px] text-blue-500" />
            Brand
            <i className="ti ti-chevron-down text-[11px]" />
          </button>
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <i className="ti ti-table text-[16px]" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <i className="ti ti-layout-grid text-[16px]" />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.length === products.length}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                  />
                </th>
                {['PRODUCT', 'CATEGORY', 'PRICE', 'COST', 'MARGIN', 'STOCK', 'FLAGS'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 tracking-wider">
                    {h}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, idx) => (
                <tr
                  key={product.id}
                  className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${
                    selected.includes(product.id) ? 'bg-blue-50/50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(product.id)}
                      onChange={() => toggleSelect(product.id)}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <i className="ti ti-photo-off text-gray-400 text-[14px]" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-gray-800 leading-tight">{product.name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{product.brand}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                      {product.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-gray-800">
                    ₹{product.price}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-gray-600">
                    ₹{product.cost}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[13px] font-semibold ${product.margin > 50 ? 'text-green-600' : 'text-gray-700'}`}>
                      {product.margin}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-gray-500">
                    {product.stock ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {product.flags.map((flag) => (
                      <span key={flag} className="text-[11px] font-medium bg-red-50 text-red-500 px-2 py-0.5 rounded-lg">
                        {flag}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                      <i className="ti ti-dots text-gray-400 text-[14px]" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100">
          <p className="text-[12px] text-gray-400">
            Showing {filtered.length} of {products.length} products
          </p>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] text-gray-500 hover:bg-gray-50 transition-colors">
              Previous
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-gray-900 text-[12px] text-white">
              1
            </button>
            <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] text-gray-500 hover:bg-gray-50 transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
