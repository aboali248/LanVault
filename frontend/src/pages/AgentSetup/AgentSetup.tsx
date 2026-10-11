import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';

export function AgentSetup() {
  const { language, setLanguage } = useApp();
  const { signOut } = useAuth();
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const isArabic = language === 'ar';

  const downloadInstaller = async () => {
    setDownloading(true);
    setError('');
    try {
      const content = await api.getAgentInstaller();
      const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'LanVault-Agent-Installer.bat';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (isArabic ? 'تعذر تنزيل ملف التثبيت' : 'Could not download the installer'));
    } finally {
      setDownloading(false);
    }
  };

  return <main className="min-h-screen bg-[#09090b] px-4 py-6 text-slate-100 sm:px-8">
    <header className="mx-auto flex max-w-4xl items-center justify-between border-b border-slate-800 pb-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-black"><Icon name="shield" /></span>
        <div><strong className="block">LanVault</strong><span className="text-xs text-slate-500">{isArabic ? 'إعداد الجهاز' : 'Device setup'}</span></div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setLanguage(isArabic ? 'en' : 'ar')} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">{isArabic ? 'EN' : 'ع'}</button>
        <Button variant="outline" onClick={signOut}>{isArabic ? 'تسجيل الخروج' : 'Sign out'}</Button>
      </div>
    </header>
    <section className="mx-auto mt-12 max-w-4xl">
      <p className="mb-3 text-xs font-bold uppercase tracking-[.22em] text-orange-400">{isArabic ? 'تسجيل جهاز جديد' : 'Enroll a device'}</p>
      <h1 className="max-w-2xl text-3xl font-black leading-tight sm:text-4xl">{isArabic ? 'ثبّت وكيل LanVault على هذا الجهاز' : 'Install the LanVault agent on this device'}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">{isArabic ? 'نزّل ملف التثبيت وشغّله باستخدام PowerShell كمسؤول. سيُسجّل الجهاز بانتظار موافقة مدير النظام، ولن يبدأ النسخ الاحتياطي قبل اعتماده.' : 'Download the installer and run it from an elevated PowerShell. The device will be registered pending administrator approval; backups cannot start until it is approved.'}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          [isArabic ? '١. نزّل الملف' : '1. Download', isArabic ? 'احفظ ملف BAT على هذا الجهاز.' : 'Save the BAT file on this computer.'],
          [isArabic ? '٢. شغّله كمسؤول' : '2. Run as admin', isArabic ? 'افتح PowerShell كمسؤول ثم شغّل الملف.' : 'Open PowerShell as Administrator and run it.'],
          [isArabic ? '٣. انتظر الاعتماد' : '3. Await approval', isArabic ? 'سيعتمد المدير الجهاز قبل تحديد الأقراص.' : 'An administrator must approve it before disks are selected.'],
        ].map(([title, detail]) => <article key={title} className="rounded-2xl border border-slate-800 bg-[#111113] p-5"><h2 className="font-bold text-orange-300">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p></article>)}
      </div>
      <div className="mt-7 rounded-2xl border border-orange-500/20 bg-orange-500/[.06] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-bold">{isArabic ? 'ملف تثبيت Agent' : 'Agent installer'}</h2><p className="mt-1 text-xs text-slate-400">{isArabic ? 'يثبّت خدمة Windows ويبدأ التسجيل بشكل تلقائي.' : 'Installs the Windows service and starts enrollment automatically.'}</p></div>
          <Button loading={downloading} icon="arrowUpRight" className="!bg-orange-500 !text-black hover:!bg-orange-400" onClick={() => void downloadInstaller()}>{isArabic ? 'تنزيل ملف BAT' : 'Download BAT installer'}</Button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-900/70 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
      </div>
      <p className="mt-5 flex gap-2 text-xs leading-5 text-slate-500"><Icon name="info" size={16} className="mt-0.5 shrink-0 text-orange-400" />{isArabic ? 'يجب أن يكون الجهاز متصلًا بشبكة الخادم، وأن تسمح سياسة Windows بتشغيل ملفات BAT. يشغّل الملف الخدمة بصلاحيات LocalSystem.' : 'This computer must be on the server network and Windows policy must allow BAT files. The installer runs the service as LocalSystem.'}</p>
    </section>
  </main>;
}
