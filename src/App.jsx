import React, { useEffect, useMemo, useRef, useState } from 'react';

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  Activity, ArrowDownToLine, ArrowLeft, BadgeCheck, CalendarDays, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList,
  Coffee, Download, Edit3, FileSpreadsheet, Filter, GlassWater, GraduationCap,
  LayoutDashboard, ListFilter, LoaderCircle, Menu, MoreHorizontal, Pencil,
  Plus, Search, Settings, ShieldCheck, Trash2, UserRound, Users, Wallet,
  X, AlertCircle, ExternalLink, RefreshCw, Save, ReceiptText
} from 'lucide-react';

const STORAGE_KEY = 'aurora26-party-manager-v1';
const DEFAULT_SETTINGS = {
  eventName: "AURORA '26 Batch Party",
  schoolName: 'Kiwuldeniya Mahanama Maha Vidyalaya',
  withDrinksFee: 4400,
  withoutDrinksFee: 4400,
  sheetUrl: ''
};

const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 })}`;
const dateLabel = (value) => new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const currencyNumber = (value) => Math.max(0, Number(value) || 0);
const makeReceiptNo = () => `AUR26-${Date.now().toString().slice(-7)}`;
const readSaved = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      people: Array.isArray(saved.people) ? saved.people : [],
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) }
    };
  } catch {
    return { people: [], settings: DEFAULT_SETTINGS };
  }
};

// Only these settings are stored in the Google Sheet "Settings" tab.
// (sheetUrl stays in the browser, otherwise the app could not find the sheet.)
const pickSheetSettings = (s) => ({
  eventName: String(s.eventName || '').trim(),
  schoolName: String(s.schoolName || '').trim(),
  withDrinksFee: Number(s.withDrinksFee) || 0,
  withoutDrinksFee: Number(s.withoutDrinksFee) || 0
});

const normalizeSheetSettings = (incoming = {}) => {
  const out = {};
  if (typeof incoming.eventName === 'string' && incoming.eventName.trim()) out.eventName = incoming.eventName;
  if (typeof incoming.schoolName === 'string' && incoming.schoolName.trim()) out.schoolName = incoming.schoolName;
  if (incoming.withDrinksFee !== undefined && Number.isFinite(Number(incoming.withDrinksFee))) out.withDrinksFee = Number(incoming.withDrinksFee);
  if (incoming.withoutDrinksFee !== undefined && Number.isFinite(Number(incoming.withoutDrinksFee))) out.withoutDrinksFee = Number(incoming.withoutDrinksFee);
  return out;
};

const withQuery = (url, query) => `${url}${url.includes('?') ? '&' : '?'}${query}`;

function App() {
  const initial = useMemo(readSaved, []);
  const [people, setPeople] = useState(initial.people);
  const [settings, setSettings] = useState(initial.settings);
  const [activePage, setActivePage] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const toastTimer = useRef(null);
  const settingsLock = useRef(false); // blocks sheet->settings overwrite while saving settings

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ people, settings }));
  }, [people, settings]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Load from Google Sheet when the URL is set, then refresh every 30 seconds
  useEffect(() => {
    const url = settings.sheetUrl.trim();
    if (!url) return;
    loadFromSheet(url, true);
    const timer = setInterval(() => loadFromSheet(url, true), 30000);
    return () => clearInterval(timer);
  }, [settings.sheetUrl]);

  const notify = (message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  };

  const stats = useMemo(() => {
    const withDrinks = people.filter((p) => p.drinks === 'Yes');
    const withoutDrinks = people.filter((p) => p.drinks !== 'Yes');
    const sum = (list, field) => list.reduce((total, p) => total + Number(p[field] || 0), 0);
    return {
      count: people.length,
      withCount: withDrinks.length,
      withoutCount: withoutDrinks.length,
      totalExpected: sum(people, 'totalAmount'),
      collected: sum(people, 'advanceAmount'),
      outstanding: sum(people, 'outstandingAmount'),
      withTotal: sum(withDrinks, 'totalAmount'),
      withoutTotal: sum(withoutDrinks, 'totalAmount'),
      withPaid: sum(withDrinks, 'advanceAmount'),
      withoutPaid: sum(withoutDrinks, 'advanceAmount'),
    };
  }, [people]);

  const filteredPeople = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...people]
      .filter((p) => {
        const matchesQuery = !query || [p.name, p.receiptNo, String(p.birthYear)].some((v) => String(v || '').toLowerCase().includes(query));
        const matchesFilter = filter === 'all' || (filter === 'drinks' && p.drinks === 'Yes') || (filter === 'no-drinks' && p.drinks !== 'Yes') || (filter === 'outstanding' && Number(p.outstandingAmount) > 0) || (filter === 'paid' && Number(p.outstandingAmount) === 0);
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [people, search, filter]);

  const sheetReady = Boolean(settings.sheetUrl.trim());

  // ---------- Google Sheets: READ (people + settings) ----------
  async function loadFromSheet(url = settings.sheetUrl, silent = false) {
    const target = (url || '').trim();
    if (!target) return false;
    setLoading(true);
    try {
      const res = await fetch(withQuery(target, `action=list&t=${Date.now()}`));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Sheet error');

      setPeople(Array.isArray(data.people) ? data.people : []);

      if (data.settings && !settingsLock.current) {
        const fromSheet = normalizeSheetSettings(data.settings);
        setSettings((current) => {
          const merged = { ...current, ...fromSheet };
          return JSON.stringify(merged) === JSON.stringify(current) ? current : merged;
        });
      }

      if (!silent) notify(`Google Sheet eken ${data.people.length} records load una.`);
      return true;
    } catch (error) {
      console.error('Load from Google Sheets failed:', error);
      if (!silent) notify('Could not load data from Google Sheets.', 'warning');
      return false;
    } finally {
      setLoading(false);
    }
  }

  // ---------- Google Sheets: WRITE ----------
  async function postToSheet(url, body) {
    // Apps Script accepts text/plain without a browser CORS preflight.
    await fetch(url.trim(), {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  }

  async function syncToSheet(action, person) {
    if (!settings.sheetUrl.trim()) return { skipped: true };
    setSyncing(true);
    try {
      await postToSheet(settings.sheetUrl, { action, person });
      await loadFromSheet(settings.sheetUrl, true); // pull fresh data from the sheet
      return { sent: true };
    } catch (error) {
      console.error('Google Sheets sync failed:', error);
      return { error: true };
    } finally {
      setSyncing(false);
    }
  }

  function openAddModal() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEditModal(person) {
    setEditing(person);
    setModalOpen(true);
  }

  async function savePerson(formData) {
    const isEditing = Boolean(editing);
    const updatedAt = new Date().toISOString();
    const person = {
      ...(editing || {}),
      ...formData,
      id: editing?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      receiptNo: editing?.receiptNo || makeReceiptNo(),
      createdAt: editing?.createdAt || updatedAt,
      updatedAt
    };
    setPeople((current) => isEditing ? current.map((p) => p.id === person.id ? person : p) : [person, ...current]);
    setModalOpen(false);
    setEditing(null);
    const syncResult = await syncToSheet('upsert', person);
    notify(isEditing ? 'Record updated.' : 'Attendee added.', syncResult.error ? 'warning' : 'success');
    return person;
  }

  async function deletePerson(person) {
    if (!window.confirm(`Delete ${person.name}'s record? This cannot be undone.`)) return;
    setPeople((current) => current.filter((p) => p.id !== person.id));
    const result = await syncToSheet('delete', person);
    notify(result.error ? 'Deleted locally. Google Sheets sync failed.' : 'Record deleted.', result.error ? 'warning' : 'success');
  }

  async function saveSettings(nextSettings) {
    setSettings(nextSettings);
    const url = nextSettings.sheetUrl.trim();
    if (!url) {
      notify('Settings saved in this browser. Connect Google Sheets to save them online.');
      return;
    }
    settingsLock.current = true;
    setSyncing(true);
    try {
      await postToSheet(url, { action: 'saveSettings', settings: pickSheetSettings(nextSettings) });
      notify('Settings saved to Google Sheet (Settings tab).');
    } catch (error) {
      console.error('Settings sync failed:', error);
      notify('Settings saved locally. Google Sheets sync failed.', 'warning');
    } finally {
      settingsLock.current = false;
      setSyncing(false);
    }
  }

  async function getLogoData() {
    const response = await fetch('/assets/aurora-26-emblem.png');
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  async function downloadReceipt(person) {
    let receiptNode;
    try {
      const logo = await getLogoData();
      await document.fonts.ready;
      receiptNode = document.createElement('div');
      receiptNode.style.cssText = [
        'position:fixed', 'left:-10000px', 'top:0', 'width:560px', 'height:792px',
        'box-sizing:border-box', 'padding:34px 38px', 'background:#190807',
        'color:#f5e8d2', 'font-family:"Noto Sans Sinhala","DM Sans",sans-serif',
        'overflow:hidden', 'border:3px solid #dba93c', 'outline:1px solid #6d3818',
        'outline-offset:-12px'
      ].join(';');
      const item = (label, value) => `<div style="display:flex;justify-content:space-between;gap:18px;padding:13px 0;border-bottom:1px solid rgba(224,174,79,.17);font-size:13px"><span style="color:#c3aa8d">${escapeHtml(label)}</span><strong style="color:#fff0d1;text-align:right;max-width:65%;overflow-wrap:anywhere">${escapeHtml(value)}</strong></div>`;
      receiptNode.innerHTML = `
        <div style="text-align:center;display:flex;flex-direction:column;align-items:center">
          <img src="${logo}" alt="AURORA emblem" style="width:116px;height:116px;object-fit:cover;border-radius:50%;border:1px solid #c89532" />
          <div style="font-family:'Playfair Display',serif;font-weight:800;font-size:37px;letter-spacing:1px;color:#f6d477;margin-top:9px">AURORA '26</div>
          <div style="font-size:11px;letter-spacing:2px;color:#dfc58c;margin-top:5px">${escapeHtml(String(settings.schoolName || '').toUpperCase())}</div>
          <div style="height:1px;background:#b98429;width:100%;margin:24px 0 18px"></div>
          <div style="font-size:19px;font-weight:800;letter-spacing:1.2px;color:#ffdf94">PARTY PAYMENT RECEIPT</div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;color:#bca78f;font-size:11px;margin:19px 0 7px"><span>Receipt No: ${escapeHtml(person.receiptNo)}</span><span>Date: ${escapeHtml(dateLabel(person.updatedAt || person.createdAt))}</span></div>
        <div style="height:1px;background:rgba(224,174,79,.22);margin-bottom:7px"></div>
        ${item('Attendee name', person.name)}
        ${item('Birth year', person.birthYear)}
        ${item('Drinks option', person.drinks === 'Yes' ? 'With drinks' : 'Without drinks')}
        ${item('Total amount', money(person.totalAmount))}
        ${item('Advance paid', money(person.advanceAmount))}
        <div style="margin-top:24px;padding:17px 19px;background:#4b1a10;border:1px solid #a76c26;border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div><div style="font-size:10px;letter-spacing:1.2px;color:#e4c58d;font-weight:800">OUTSTANDING BALANCE</div><div style="font-size:10px;color:#bf9d77;margin-top:5px">${Number(person.outstandingAmount) === 0 ? 'Payment completed' : 'Balance to be settled'}</div></div>
          <strong style="font-family:'Playfair Display',serif;font-size:24px;color:#ffdc83;white-space:nowrap">${escapeHtml(money(person.outstandingAmount))}</strong>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:35px;text-align:center;font-size:10px;color:#a58b6b;letter-spacing:.4px">Thank you. Keep this receipt for your records.</div>
      `;
      document.body.appendChild(receiptNode);
      // Wait one frame so the external Sinhala font and logo are painted before capture.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await html2canvas(receiptNode, { scale: 2, backgroundColor: '#190807', useCORS: true, logging: false });
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 148, 210, undefined, 'FAST');
      doc.save(`${person.receiptNo}-receipt.pdf`);
      notify('PDF receipt downloaded.');
    } catch (error) {
      console.error(error);
      notify('Could not generate the PDF receipt.', 'warning');
    } finally {
      receiptNode?.remove();
    }
  }

  async function downloadReport() {
    let reportNode;
    try {
      const logo = await getLogoData();
      await document.fonts.ready;
      const sorted = [...people].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const pageSize = 12;
      const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      for (let page = 0; page < pageCount; page += 1) {
        const pagePeople = sorted.slice(page * pageSize, (page + 1) * pageSize);
        reportNode = document.createElement('div');
        reportNode.style.cssText = 'position:fixed;left:-12000px;top:0;width:1120px;height:790px;box-sizing:border-box;padding:32px 38px;background:#190807;color:#f5e8d2;font-family:"Noto Sans Sinhala","DM Sans",sans-serif;overflow:hidden;border:3px solid #dba93c;';
        const bodyRows = pagePeople.map((p, index) => `
          <tr style="background:${index % 2 === 0 ? 'rgba(255,255,255,.035)' : 'transparent'}">
            <td>${escapeHtml(p.receiptNo)}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.birthYear)}</td>
            <td>${p.drinks === 'Yes' ? 'With drinks' : 'No drinks'}</td><td>${escapeHtml(money(p.totalAmount))}</td>
            <td>${escapeHtml(money(p.advanceAmount))}</td><td>${escapeHtml(money(p.outstandingAmount))}</td>
          </tr>`).join('');
        reportNode.innerHTML = `
          <div style="display:flex;align-items:center;gap:18px;border-bottom:1px solid rgba(224,174,79,.28);padding-bottom:17px">
            <img src="${logo}" alt="AURORA emblem" style="width:90px;height:90px;object-fit:cover;border-radius:50%;border:1px solid #c89532" />
            <div><div style="font-family:'Playfair Display',serif;font-size:31px;font-weight:800;color:#f6d477">AURORA '26</div>
              <div style="font-size:11px;letter-spacing:1.5px;color:#d9bd82;margin-top:4px">${escapeHtml(String(settings.schoolName || '').toUpperCase())}</div>
              <div style="font-size:16px;font-weight:700;color:#fff0d1;margin-top:10px">PARTY COLLECTION REPORT</div></div>
            <div style="margin-left:auto;text-align:right;color:#b99d7a;font-size:11px;line-height:1.8">Generated: ${escapeHtml(dateLabel(new Date()))}<br/>Page ${page + 1} of ${pageCount}<br/>Attendees: ${stats.count}</div>
          </div>
          <div style="display:flex;gap:30px;margin:17px 0 15px;padding:13px 15px;background:#32130e;border:1px solid rgba(220,167,66,.2);border-radius:8px">
            <div><div style="font-size:10px;color:#bf9e74">EXPECTED TOTAL</div><strong style="font-size:17px;color:#ffe09a">${escapeHtml(money(stats.totalExpected))}</strong></div>
            <div><div style="font-size:10px;color:#bf9e74">COLLECTED</div><strong style="font-size:17px;color:#9fdaa9">${escapeHtml(money(stats.collected))}</strong></div>
            <div><div style="font-size:10px;color:#bf9e74">OUTSTANDING</div><strong style="font-size:17px;color:#f2a181">${escapeHtml(money(stats.outstanding))}</strong></div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#652716;color:#ffe0a0;text-align:left">
              <th style="padding:12px 9px">RECEIPT NO.</th><th style="padding:12px 9px">ATTENDEE NAME</th><th style="padding:12px 9px">BIRTH YEAR</th><th style="padding:12px 9px">DRINKS</th><th style="padding:12px 9px">TOTAL</th><th style="padding:12px 9px">ADVANCE</th><th style="padding:12px 9px">OUTSTANDING</th>
            </tr></thead><tbody>${bodyRows || '<tr><td colspan="7" style="padding:24px;text-align:center;color:#b99d7a">No attendee records yet.</td></tr>'}</tbody>
          </table>
          <div style="position:absolute;left:38px;right:38px;bottom:23px;display:flex;justify-content:space-between;color:#8e755e;font-size:9px"><span>AURORA '26 · Batch of 2026</span><span>Keep this report for event administration.</span></div>
        `;
        document.body.appendChild(reportNode);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = await html2canvas(reportNode, { scale: 2, backgroundColor: '#190807', useCORS: true, logging: false });
        if (page > 0) doc.addPage('a4', 'landscape');
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
        reportNode.remove();
        reportNode = null;
      }
      doc.save('AURORA-26-party-collection-report.pdf');
      notify('Collection report downloaded.');
    } catch (error) {
      console.error(error);
      notify('Could not generate the collection report.', 'warning');
    } finally {
      reportNode?.remove();
    }
  }

  const pageTitle = activePage === 'dashboard' ? 'Overview' : activePage === 'attendees' ? 'Attendee Records' : 'Settings';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-block">
          <img src="/assets/aurora-26-emblem.png" alt="AURORA 26 emblem" className="brand-logo" />
          <div><div className="brand-title">AURORA <span>'26</span></div><div className="brand-subtitle">PARTY MANAGER</div></div>
          <button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19} /></button>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={activePage === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => { setActivePage('dashboard'); setMobileNav(false); }}><LayoutDashboard size={18} /> Dashboard</button>
          <button className={activePage === 'attendees' ? 'nav-item active' : 'nav-item'} onClick={() => { setActivePage('attendees'); setMobileNav(false); }}><Users size={18} /> Attendees <span className="nav-count">{people.length}</span></button>
          <button className={activePage === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => { setActivePage('settings'); setMobileNav(false); }}><Settings size={18} /> Settings</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-mini"><div className={`sync-dot ${sheetReady ? 'online' : ''}`} /><div><b>{sheetReady ? 'Sheets connected' : 'Local storage active'}</b><span>{sheetReady ? 'Google Sheets endpoint saved' : 'Connect Google Sheets in Settings'}</span></div></div>
          <div className="sidebar-footer">KIWULDENIYA MAHANAMA<br />MAHA VIDYALAYA · BATCH 2026</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-trigger" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={21} /></button>
            <div><div className="eyebrow">AURORA '26 / MANAGEMENT</div><h1>{pageTitle}</h1></div>
          </div>
          <div className="topbar-actions">
            <div className={`sync-indicator ${sheetReady ? 'connected' : ''}`}>{syncing || loading ? <LoaderCircle size={15} className="spin" /> : <span className="sync-dot" />}{syncing ? 'Syncing' : loading ? 'Loading' : sheetReady ? 'Sheets enabled' : 'Local mode'}</div>
            <button className="light-btn" onClick={() => loadFromSheet(settings.sheetUrl)} disabled={!sheetReady || loading} title="Reload from Google Sheets">
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            </button>
            <button className="top-add-btn" onClick={openAddModal}><Plus size={17} /> <span>Add attendee</span></button>
          </div>
        </header>

        {activePage === 'dashboard' && (
          <Dashboard
            stats={stats} people={people} onAdd={openAddModal} onReceipt={downloadReceipt}
            onEdit={openEditModal} onViewAll={() => setActivePage('attendees')}
            onReport={downloadReport} settings={settings}
          />
        )}
        {activePage === 'attendees' && (
          <AttendeesPage people={filteredPeople} total={people.length} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} onAdd={openAddModal} onEdit={openEditModal} onDelete={deletePerson} onReceipt={downloadReceipt} />
        )}
        {activePage === 'settings' && <SettingsPage settings={settings} onSave={saveSettings} sheetReady={sheetReady} />}

        <footer className="main-footer"><span>© 2026 AURORA '26 · Party Management</span><span>Designed for Kiwuldeniya Mahanama Maha Vidyalaya</span></footer>
      </main>

      {modalOpen && <AttendeeModal key={editing?.id || 'new'} person={editing} settings={settings} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={savePerson} />}
      {toast && <div className={`toast ${toast.type}`}><span className="toast-icon">{toast.type === 'warning' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}</span>{toast.message}<button onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button></div>}
    </div>
  );
}

function Dashboard({ stats, people, onAdd, onReceipt, onEdit, onViewAll, onReport, settings }) {
  const recent = [...people].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const paidPercent = stats.totalExpected ? Math.min(100, Math.round(stats.collected / stats.totalExpected * 100)) : 0;
  return (
    <div className="page-wrap dashboard-page">
      <section className="hero-banner">
        <img src="/assets/aurora-26-main.png" alt="AURORA 26 batch artwork" className="hero-art" />
        <div className="hero-copy"><span className="hero-kicker">THE BATCH OF 2026</span><h2>One night.<br /><em>One legacy.</em></h2><p>Keep every contribution organised and every attendee accounted for.</p><button className="hero-button" onClick={onAdd}><Plus size={16} /> Register an attendee</button></div>
        <div className="hero-stamp"><span>PARTY</span><strong>2026</strong><span>COLLECTIONS</span></div>
      </section>

      <div className="section-heading"><div><span className="section-kicker">LIVE SUMMARY</span><h2>Collection overview</h2></div><div className="section-date"><CalendarDays size={15} /> {dateLabel(new Date())}</div></div>
      <section className="stats-grid">
        <StatCard icon={<Users size={19} />} label="Registered attendees" value={stats.count.toLocaleString()} helper="Total party registrations" tone="gold" />
        <StatCard icon={<Wallet size={19} />} label="Total collected" value={money(stats.collected)} helper={`${paidPercent}% of expected collection`} tone="green" />
        <StatCard icon={<CircleDollarSign size={19} />} label="Outstanding" value={money(stats.outstanding)} helper="Pending advance balance" tone="red" />
        <StatCard icon={<ClipboardList size={19} />} label="Expected total" value={money(stats.totalExpected)} helper="Based on selected drink options" tone="violet" />
      </section>

      <div className="section-heading split-heading"><div><span className="section-kicker">DRINK PREFERENCES</span><h2>Separate group totals</h2></div><span className="subtle-note">Per-person fees can be changed in Settings</span></div>
      <section className="drink-grid">
        <div className="drink-card"><div className="drink-card-top"><div className="drink-icon with"><GlassWater size={20} /></div><span className="group-tag">GROUP 01</span></div><h3>With drinks</h3><div className="drink-count"><strong>{stats.withCount}</strong><span>attendees</span></div><div className="drink-divider" /><div className="drink-metrics"><div><span>Expected total</span><b>{money(stats.withTotal)}</b></div><div><span>Advance paid</span><b>{money(stats.withPaid)}</b></div></div><div className="drink-footer"><span>Fee per person</span><b>{money(settings.withDrinksFee)}</b></div></div>
        <div className="drink-card"><div className="drink-card-top"><div className="drink-icon without"><Coffee size={20} /></div><span className="group-tag">GROUP 02</span></div><h3>Without drinks</h3><div className="drink-count"><strong>{stats.withoutCount}</strong><span>attendees</span></div><div className="drink-divider" /><div className="drink-metrics"><div><span>Expected total</span><b>{money(stats.withoutTotal)}</b></div><div><span>Advance paid</span><b>{money(stats.withoutPaid)}</b></div></div><div className="drink-footer"><span>Fee per person</span><b>{money(settings.withoutDrinksFee)}</b></div></div>
      </section>

      <section className="collection-panel">
        <div className="collection-head"><div><span className="section-kicker">PAYMENT PROGRESS</span><h2>Collection status</h2></div><div className="collection-total">{paidPercent}% <span>collected</span></div></div>
        <div className="progress-track"><div className="progress-value" style={{ width: `${paidPercent}%` }} /></div>
        <div className="progress-labels"><span><i className="legend-dot paid-dot" /> Collected <b>{money(stats.collected)}</b></span><span><i className="legend-dot due-dot" /> Outstanding <b>{money(stats.outstanding)}</b></span></div>
      </section>

      <section className="recent-panel">
        <div className="panel-heading"><div><span className="section-kicker">LATEST ACTIVITY</span><h2>Recent attendees</h2></div><div className="panel-actions"><button className="light-btn" onClick={onReport}><Download size={15} /> Export report</button><button className="text-btn" onClick={onViewAll}>View all <ChevronRight size={15} /></button></div></div>
        {recent.length === 0 ? <EmptyState onAdd={onAdd} /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>ATTENDEE</th><th>BIRTH YEAR</th><th>DRINKS</th><th>TOTAL</th><th>ADVANCE</th><th>OUTSTANDING</th><th /></tr></thead><tbody>{recent.map((p) => <PersonRow key={p.id} person={p} onReceipt={onReceipt} onEdit={onEdit} compact />)}</tbody></table></div>}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, helper, tone }) {
  return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><span className="stat-helper">{helper}</span></div>;
}

function AttendeesPage({ people, total, search, setSearch, filter, setFilter, onAdd, onEdit, onDelete, onReceipt }) {
  return <div className="page-wrap records-page">
    <div className="records-intro"><div><span className="section-kicker">PARTY GUEST LIST</span><h2>Attendee records</h2><p>Manage registrations, advance payments and remaining balances.</p></div><button className="primary-btn" onClick={onAdd}><Plus size={17} /> Add attendee</button></div>
    <div className="records-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or receipt number..." /></div><div className="filter-box"><Filter size={16} /><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter attendees"><option value="all">All attendees ({total})</option><option value="drinks">With drinks</option><option value="no-drinks">Without drinks</option><option value="outstanding">Outstanding balance</option><option value="paid">Fully paid</option></select><ChevronDown size={15} /></div></div>
    <div className="records-card"><div className="records-card-head"><div><b>All registrations</b><span>{people.length} records shown</span></div><span className="records-count">{people.length} / {total}</span></div>
      {people.length === 0 ? <div className="empty-records"><div className="empty-icon"><Users size={24} /></div><h3>No attendee records found</h3><p>Add an attendee or adjust your search filters.</p><button className="primary-btn" onClick={onAdd}><Plus size={16} /> Add first attendee</button></div> : <div className="table-wrap"><table className="data-table full-table"><thead><tr><th>ATTENDEE</th><th>RECEIPT NO.</th><th>BIRTH YEAR</th><th>DRINKS</th><th>TOTAL</th><th>ADVANCE</th><th>OUTSTANDING</th><th>PAYMENT</th><th>ACTIONS</th></tr></thead><tbody>{people.map((p) => <PersonRow key={p.id} person={p} onReceipt={onReceipt} onEdit={onEdit} onDelete={onDelete} />)}</tbody></table></div>}
    </div>
  </div>;
}

function PersonRow({ person, onReceipt, onEdit, onDelete, compact = false }) {
  const outstanding = Number(person.outstandingAmount || 0);
  return <tr>
    <td><div className="person-cell"><div className="avatar">{(person.name || '?').trim().charAt(0).toUpperCase()}</div><div><b>{person.name}</b><span>Registered {dateLabel(person.createdAt)}</span></div></div></td>
    {!compact && <td><span className="receipt-code">{person.receiptNo}</span></td>}
    <td>{person.birthYear}</td>
    <td><span className={`drink-pill ${person.drinks === 'Yes' ? 'yes' : 'no'}`}>{person.drinks === 'Yes' ? 'With drinks' : 'No drinks'}</span></td>
    <td className="amount-cell">{money(person.totalAmount)}</td><td className="amount-cell paid-amount">{money(person.advanceAmount)}</td><td className={`amount-cell ${outstanding > 0 ? 'due-amount' : 'paid-amount'}`}>{money(outstanding)}</td>
    {!compact && <td><span className={`status-pill ${outstanding > 0 ? 'pending' : 'complete'}`}>{outstanding > 0 ? 'Pending' : 'Paid'}</span></td>}
    <td><div className="row-actions"><button className="action-btn receipt-action" title="Download PDF receipt" onClick={() => onReceipt(person)}><Download size={15} /></button><button className="action-btn" title="Edit record" onClick={() => onEdit(person)}><Pencil size={15} /></button>{onDelete && <button className="action-btn danger-action" title="Delete record" onClick={() => onDelete(person)}><Trash2 size={15} /></button>}</div></td>
  </tr>;
}

function EmptyState({ onAdd }) {
  return <div className="empty-state"><div className="empty-state-icon"><Users size={23} /></div><h3>Your guest list starts here</h3><p>Add the first attendee to begin tracking party payments.</p><button className="primary-btn" onClick={onAdd}><Plus size={16} /> Add attendee</button></div>;
}

function AttendeeModal({ person, settings, onClose, onSave }) {
  const [name, setName] = useState(person?.name || '');
  const [birthYear, setBirthYear] = useState(person?.birthYear || '');
  const [drinks, setDrinks] = useState(person?.drinks || 'Yes');
  const [advance, setAdvance] = useState(person?.advanceAmount ?? '');
  const [saving, setSaving] = useState(false);
  const total = Number(drinks === 'Yes' ? settings.withDrinksFee : settings.withoutDrinksFee) || 0;
  const paid = currencyNumber(advance);
  const outstanding = Math.max(0, total - paid);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Please enter the attendee name.');
    if (!birthYear || Number(birthYear) < 1900 || Number(birthYear) > new Date().getFullYear()) return setError('Please enter a valid birth year.');
    if (paid > total) return setError('Advance payment cannot be greater than the total amount.');
    setSaving(true);
    await onSave({ name: name.trim(), birthYear: Number(birthYear), drinks, totalAmount: total, advanceAmount: paid, outstandingAmount: outstanding });
    setSaving(false);
  }

  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="attendee-modal">
    <div className="modal-head"><div><span className="section-kicker">AURORA '26 REGISTRATION</span><h2>{person ? 'Edit attendee' : 'Add new attendee'}</h2><p>Enter the attendee details and advance payment.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <form onSubmit={submit}>
      <label className="field-label">Attendee full name <span>*</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter full name" /></label>
      <div className="form-two-col"><label className="field-label">Birth year <span>*</span><input type="number" min="1900" max={new Date().getFullYear()} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="e.g. 2007" /></label><div className="field-label">Drinks preference <span>*</span><div className="choice-grid"><button type="button" className={`choice-card ${drinks === 'Yes' ? 'selected' : ''}`} onClick={() => setDrinks('Yes')}><GlassWater size={18} /><b>With drinks</b><span>Included</span></button><button type="button" className={`choice-card ${drinks === 'No' ? 'selected' : ''}`} onClick={() => setDrinks('No')}><Coffee size={18} /><b>No drinks</b><span>Not included</span></button></div></div></div>
      <div className="payment-breakdown"><div><span>Total amount</span><strong>{money(total)}</strong></div><label className="field-label advance-label">Advance amount (Rs.)<input type="number" min="0" max={total} step="0.01" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="Enter amount paid" /></label><div className="outstanding-preview"><span>Outstanding amount</span><strong>{money(outstanding)}</strong></div></div>
      {error && <div className="form-error"><AlertCircle size={15} /> {error}</div>}
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}{saving ? 'Saving...' : person ? 'Save changes' : 'Save attendee'}</button></div>
    </form>
  </div></div>;
}

function SettingsPage({ settings, onSave, sheetReady }) {
  const [form, setForm] = useState(settings);
  const [showHelp, setShowHelp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // When settings arrive from the Google Sheet, show them in the form
  useEffect(() => { setForm(settings); }, [settings]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (Number(form.withDrinksFee) < 0 || Number(form.withoutDrinksFee) < 0) return;
    if (!String(form.eventName).trim() || !String(form.schoolName).trim()) return;
    setSaving(true);
    await onSave({
      ...form,
      eventName: form.eventName.trim(),
      schoolName: form.schoolName.trim(),
      withDrinksFee: Number(form.withDrinksFee),
      withoutDrinksFee: Number(form.withoutDrinksFee),
      sheetUrl: form.sheetUrl.trim()
    });
    setSaving(false);
  }

  async function testConnection() {
    if (!form.sheetUrl.trim()) return;
    setTesting(true);
    try {
      const url = form.sheetUrl.trim();
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}action=list&t=${Date.now()}`);
      const data = await res.json();
      if (data.ok) {
        const keys = Object.keys(data.settings || {}).length;
        alert(`Connected ✅\nAttendees: ${data.count}\nSaved settings in sheet: ${keys}`);
      } else {
        alert('Connected but error: ' + data.error);
      }
    } catch {
      alert('Connect wenne naha. URL eka (/exec) saha deployment access "Anyone" kiyala check karanna.');
    } finally { setTesting(false); }
  }

  return <div className="page-wrap settings-page">
    <div className="records-intro"><div><span className="section-kicker">SYSTEM CONFIGURATION</span><h2>Settings</h2><p>Configure your party fees and Google Sheets connection.</p></div><span className="settings-badge"><ShieldCheck size={16} /> Admin settings</span></div>
    <form className="settings-layout" onSubmit={submit}>
      <div className="settings-main">
        <section className="settings-card"><div className="settings-card-title"><div className="settings-icon"><CircleDollarSign size={19} /></div><div><h3>Party fee configuration</h3><p>These amounts are used to calculate each attendee's total and outstanding balance.</p></div></div>
          <div className="settings-field-grid"><label className="field-label">Fee — with drinks (Rs.)<input type="number" min="0" step="0.01" value={form.withDrinksFee} onChange={(e) => update('withDrinksFee', e.target.value)} /></label><label className="field-label">Fee — without drinks (Rs.)<input type="number" min="0" step="0.01" value={form.withoutDrinksFee} onChange={(e) => update('withoutDrinksFee', e.target.value)} /></label></div>
          <div className="settings-note"><AlertCircle size={16} /><span>Both options start at Rs. 4,400. Change the no-drinks amount above if that group has a different fee. Fee changes apply to new or edited records; existing records keep their saved totals until edited.</span></div>
        </section>
        <section className="settings-card"><div className="settings-card-title"><div className="settings-icon"><FileSpreadsheet size={19} /></div><div><h3>Google Sheets integration</h3><p>Send attendee registrations, edits and deletions to your Google Sheet. Fees and event details are saved in the "Settings" tab.</p></div></div>
          <label className="field-label">Apps Script Web App URL<input type="url" value={form.sheetUrl} onChange={(e) => update('sheetUrl', e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" /></label>
          <div className="connection-row"><div className={`connection-status ${form.sheetUrl.trim() ? 'active' : ''}`}><span className="sync-dot" />{form.sheetUrl.trim() ? 'Endpoint URL entered' : 'Not connected'}</div><button type="button" className="light-btn" disabled={!form.sheetUrl.trim() || testing} onClick={testConnection}>{testing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Test request</button></div>
          <button type="button" className="help-toggle" onClick={() => setShowHelp(!showHelp)}><span>How to connect Google Sheets</span><ChevronDown size={16} className={showHelp ? 'rotate' : ''} /></button>
          {showHelp && <div className="setup-steps"><ol><li>Create a new Google Sheet and open <b>Extensions → Apps Script</b>.</li><li>Open the <code>google-apps-script/Code.gs</code> file included in this project, paste it into Apps Script and replace <code>YOUR_SPREADSHEET_ID</code> with your Sheet ID.</li><li>Save, choose <b>Deploy → New deployment → Web app</b>.</li><li>Set <b>Execute as: Me</b> and access to <b>Anyone</b>, then deploy and authorise it.</li><li>Copy the Web App URL ending in <code>/exec</code>, paste it above and click Save settings.</li></ol><div className="security-warning"><AlertCircle size={16} /><span>The deployed endpoint can receive data from anyone who has its URL. Keep the URL private, use this only for event records, and remove/restrict the deployment after the event.</span></div></div>}
        </section>
        <section className="settings-card"><div className="settings-card-title"><div className="settings-icon"><GraduationCap size={19} /></div><div><h3>Event details</h3><p>Names used in the app's navigation and reports.</p></div></div><div className="settings-field-grid"><label className="field-label">Event name<input value={form.eventName} onChange={(e) => update('eventName', e.target.value)} /></label><label className="field-label">School name<input value={form.schoolName} onChange={(e) => update('schoolName', e.target.value)} /></label></div></section>
        <div className="settings-save-row"><span>{sheetReady ? 'Changes are saved in this browser and in your Google Sheet when you click Save.' : 'Changes are saved in this browser when you click Save.'}</span><button type="submit" className="primary-btn" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} {saving ? 'Saving...' : 'Save settings'}</button></div>
      </div>
      <aside className="settings-aside"><img src="/assets/aurora-26-emblem.png" alt="AURORA 26 artwork" /><div className="aside-tag">BATCH OF 2026</div><h3>AURORA '26</h3><p>{settings.schoolName}</p><div className="aside-divider" /><div className="aside-meta"><span>LOCAL DATA</span><b>Browser storage</b></div><div className="aside-meta"><span>GOOGLE SHEETS</span><b>{sheetReady ? 'Configured' : 'Not configured'}</b></div></aside>
    </form>
  </div>;
}

export default App;