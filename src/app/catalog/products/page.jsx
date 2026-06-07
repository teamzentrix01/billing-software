"use client";

import { useEffect, useMemo, useState } from "react";
import CatalogDataPage from "@/components/CatalogDataPage";
import SearchableSelect from "@/components/SearchableSelect";

const columns = [
  { key: "sno", label: "S. No.", sortable: true },
  { key: "name", label: "Product Name", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "brand", label: "Brand", sortable: true },
  { key: "price", label: "Price", sortable: true },
  { key: "stock", label: "Stock", sortable: true },
];

export default function ProductsPage() {
  const [departmentId, setDepartmentId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departments, setDepartments] = useState([]);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [deptRes, brandRes, catRes] = await Promise.all([
          fetch("/api/catalog/departments?pageSize=200"),
          fetch("/api/catalog/brands?pageSize=200"),
          fetch("/api/catalog/categories?pageSize=200"),
        ]);
        const deptJson = await deptRes.json();
        const brandJson = await brandRes.json();
        const catJson = await catRes.json();
        if (deptJson.success) setDepartments(deptJson.data.records || []);
        if (brandJson.success) setBrands(brandJson.data.records || []);
        if (catJson.success) setCategories(catJson.data.records || []);
      } catch {
        setDepartments([]);
        setBrands([]);
        setCategories([]);
      }
    })();
  }, []);

  const filters = useMemo(
    () => (
      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Department
          </label>
          <SearchableSelect
            value={departmentId}
            onChange={setDepartmentId}
            placeholder="ALL"
            searchPlaceholder="Search department..."
            options={departments.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Brand
          </label>
          <SearchableSelect
            value={brandId}
            onChange={setBrandId}
            placeholder="ALL"
            searchPlaceholder="Search brand..."
            options={brands.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Category
          </label>
          <SearchableSelect
            value={categoryId}
            onChange={setCategoryId}
            placeholder="ALL"
            searchPlaceholder="Search category..."
            options={categories.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </div>
      </div>
    ),
    [brandId, brands, categoryId, categories, departmentId, departments],
  );

  return (
    <CatalogDataPage
      endpoint="/api/catalog/products"
      breadcrumbs={[
        { label: "Catalog", href: "/catalog" },
        { label: "Product", href: "/catalog/products" },
        { label: "Products" },
      ]}
      title="Products"
      description="Manage all products in your catalog."
      columns={columns}
      filters={filters}
      createLabel="Create Product"
      onCreateClick={() => (window.location.href = "/catalog/products/create")}
      showRowActions={true}
      onEdit={(row) =>
        (window.location.href = `/catalog/products/${row.id}/edit`)
      }
      onDelete={(row) => {
        /* delete handled by CatalogDataPage */
      }}
      totalLabel="Product(s)"
      emptyMessage="No products found"
      bulkImportType="products"
      customBulkActions={[
        {
          label: "Print Barcodes",
          action: ({ selectedIds, showToast }) => {
            if (!selectedIds.length) {
              showToast("Select products to print barcodes", "error");
              return;
            }
            window.open(
              `/catalog/products/barcodes?ids=${selectedIds.join(",")}`,
              "_blank",
            );
          },
        },
      ]}
      extraQueryParams={{
        department_id: departmentId,
        brand_id: brandId,
        category_id: categoryId,
      }}
      mapRecord={(record, index, page, pageSize) => ({
        id: record.id,
        sno: (page - 1) * pageSize + index + 1,
        name: record.name,
        category: record.category_name || "—",
        brand: record.brand_name || "—",
        price: `₹${record.selling_price ?? record.mrp ?? 0}`,
        stock: record.actual_stock ?? "—",
      })}
    />
  );
}
