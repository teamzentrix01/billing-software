"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';

export default function StoresListPage() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/stores');
        const json = await res.json();
        if (mounted && res.ok && json.success) {
          setStores(Array.isArray(json.data?.stores) ? json.data.stores : []);
        }
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Stores List</h2>
        <Link href="/setup/storeslist/store/create" className="px-3 py-2 bg-blue-600 text-white rounded">
          Create Store
        </Link>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : stores.length === 0 ? (
        <p className="text-gray-500">No stores available.</p>
      ) : (
        <div className="bg-white rounded border p-4">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="p-2">Store Code</th>
                <th className="p-2">Name</th>
                <th className="p-2">City</th>
                <th className="p-2">Manager</th>
                <th className="p-2">Contact</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.meta?.storeCode || s.meta?.shortCode || '—'}</td>
                  <td className="p-2">{s.name}</td>
                  <td className="p-2">{s.city}</td>
                  <td className="p-2">{s.manager_name}</td>
                  <td className="p-2">{s.manager_mobile || s.manager_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </MainLayout>
  );
}