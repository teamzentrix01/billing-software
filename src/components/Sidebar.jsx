'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar({
  items = [],
  activeMenu,
  setActiveMenu,
  expanded = false,
  onRequestOpen,
  mobileOpen,
  onMobileClose,
  onMobileSubOpen,
}) {
  const pathname = usePathname();
  const [hoveredLabel, setHoveredLabel] = useState(null);
  const descriptions = {
    Home: 'Open dashboard and store setup checklist.',
    Sales: 'Create bills, returns, and POS transactions.',
    Catalog: 'Manage products, categories, pricing, and taxes.',
    Inventory: 'Track stock in, transfers, validation, and batches.',
    Purchase: 'Record purchase bills, returns, and vendors.',
    'Sales Order': 'Manage quotations, sales orders, and invoices.',
    Employee: 'Manage staff, roles, counters, and permissions.',
    Customer: 'Manage customers, credit, loyalty, and ledgers.',
    Settings: 'Configure stores, devices, payments, and billing.',
    Reports: 'View sales, inventory, purchase, and tax reports.',
  };

  const handleClick = (e, item) => {
    if (item.label === 'Home') {
      onRequestOpen?.();
      setActiveMenu(null);
      onMobileClose?.();
      return;
    }

    if (item.subSidebar) {
      const isMobile =
        typeof window !== 'undefined' &&
        window.matchMedia('(max-width: 767px)').matches;

      if (isMobile) {
        e.preventDefault();
        onMobileSubOpen?.(item);
        return;
      }

      // allow navigation to the menu href (so dashboard pages open),
      // but also set active menu for subSidebar display
      setActiveMenu(item);
      onMobileClose?.();
    } else {
      setActiveMenu(null);
      onMobileClose?.();
    }
  };

  const NavItem = ({ item }) => {
    const isSubActive = activeMenu?.label === item.label;
    const isPageActive =
      pathname === item.href ||
      pathname.startsWith('/' + item.href.split('/')[1] + '/') ||
      pathname === '/' + item.href.split('/')[1];
    const isActive = isSubActive || isPageActive;
    const isHovered = hoveredLabel === item.label;

    return (
      <Link
        href={item.href}
        onClick={(e) => handleClick(e, item)}
        onMouseEnter={() => setHoveredLabel(item.label)}
        onMouseLeave={() => setHoveredLabel((current) => (current === item.label ? null : current))}
        aria-label={item.label}
        className="relative block group"
      >
        {/* Desktop */}
        <div className={`
          hidden md:flex h-12 w-12 items-center justify-center rounded-2xl
          cursor-pointer transition-all duration-200
          ${isActive ? 'bg-indigo-600 text-white shadow-[0_10px_22px_rgba(176,0,0,0.22)]' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-700'}
        `}>
          {isActive && <span className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-indigo-600" />}
          <i className={`ti ${item.icon} text-[22px]`} />
        </div>

        {/* Mobile */}
        <div className={`
          md:hidden flex items-center gap-3 px-4 py-3
          cursor-pointer transition-all duration-150 border-b border-gray-100
          ${isActive ? 'bg-indigo-50 border-l-[3px] border-l-indigo-500' : 'hover:bg-slate-50 border-l-[3px] border-l-transparent'}
        `}>
          <i className={`ti ${item.icon} text-[22px] flex-shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-700'}`} />
          <span className={`text-[14px] font-medium ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>
            {item.label}
          </span>
          {item.subSidebar && (
            <i className={`ti ti-chevron-right text-[13px] ml-auto ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
          )}
        </div>

        <span className={`pointer-events-none absolute left-[66px] top-1/2 z-[200] hidden w-[290px] -translate-y-1/2 rounded-2xl border border-[#B00000] bg-[#B00000] px-4 py-3.5 text-left shadow-none transition-all duration-200 ease-out md:block ${isHovered ? 'visible translate-x-2 scale-100 opacity-100' : 'invisible translate-x-0 scale-95 opacity-0'}`}>
          <span className="flex items-center gap-2 text-[16px] font-extrabold tracking-wide text-white">
            <i className={`ti ${item.icon} text-[19px]`} />
            {item.label}
          </span>
          <span className="mt-2 block whitespace-normal text-[13px] font-medium leading-snug text-white">
            {item.description || descriptions[item.label] || `Open ${item.label}`}
          </span>
        </span>
      </Link>
    );
  };

  const ExpandedNavItem = ({ item }) => {
    const isPageActive =
      pathname === item.href ||
      pathname.startsWith('/' + item.href.split('/')[1] + '/') ||
      pathname === '/' + item.href.split('/')[1];

    return (
      <Link
        href={item.href}
        onClick={(e) => handleClick(e, item)}
        className={`group flex min-h-[76px] flex-col items-center justify-center rounded-xl border p-2 text-center transition-all duration-200 ${
          isPageActive
            ? 'border-indigo-100 bg-indigo-50 text-indigo-700 shadow-sm'
            : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-100 hover:bg-indigo-50 hover:text-indigo-700'
        }`}
      >
        <i className={`ti ${item.icon} text-[24px] ${isPageActive ? 'text-indigo-700' : 'text-slate-600 group-hover:text-indigo-700'}`} />
        <span className="mt-1.5 text-[12px] font-semibold leading-tight">{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <div
        className={`sidebar-overlay md:hidden ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onMobileClose}
      />

      <div className={`
        sidebar-drawer fixed left-0 top-0 h-full w-[280px] bg-white z-50 shadow-2xl
        flex flex-col md:hidden
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <img src="/buyzaar-sync-logo.svg" alt="Buyzaar Sync" className="h-10 w-auto object-contain" />
            <p className="text-[10px] text-gray-400">India's No.1 Business App</p>
          </div>
          <button onClick={onMobileClose} className="p-2 rounded-lg hover:bg-slate-100">
            <i className="ti ti-x text-slate-500 text-[18px]" />
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto overflow-x-hidden">
          {items.map((item) => (
            <NavItem key={item.label} item={item} />
          ))}
        </div>

        <div className="border-t border-gray-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center">
              <span className="text-[11px] font-bold text-white">AD</span>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-gray-800">Admin User</p>
              <p className="text-[11px] text-gray-400">Super Chain Admin</p>
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <aside className="hidden md:flex fixed left-0 top-[56px] h-[calc(100vh-56px)] w-[240px] flex-col overflow-hidden border-r border-slate-200/80 bg-white/95 z-40 shadow-[2px_0_18px_rgba(15,23,42,0.04)]">
          <div className="no-scrollbar grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto overflow-x-hidden p-3">
            {items.map((item) => (
              <ExpandedNavItem key={item.label} item={item} />
            ))}
          </div>
        </aside>
      ) : (
      <aside className="hidden md:flex fixed left-0 top-[56px] h-[calc(100vh-56px)] w-[64px] flex-col items-center overflow-visible border-r border-slate-200/80 bg-white/95 z-40 shadow-[2px_0_18px_rgba(15,23,42,0.04)]">
        {/* <div className="flex w-full justify-center border-b border-slate-100 px-2 py-3">
          <button
            type="button"
            onClick={() => {
              setActiveMenu(null);
              onRequestOpen?.();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-[0_10px_22px_rgba(176,0,0,0.2)] transition-all hover:bg-indigo-700 hover:shadow-[0_12px_26px_rgba(176,0,0,0.26)]"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <img src="/buyzaar-sync-icon.svg" alt="" className="h-8 w-8 object-contain" aria-hidden="true" />
          </button>
        </div> */}
        <div className="no-scrollbar flex-1 space-y-2 overflow-visible px-2 py-3">
          {items.map((item) => (
            <NavItem key={item.label} item={item} />
          ))}
        </div>
      </aside>
      )}
    </>
  );
}
