import type { AppSettings } from '../../types';
import { useApp } from '../../contexts/AppContext';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { api } from '../../services/api';
import type { ReplicationStatus, StorageBrowseResult, StorageCheckResult } from '../../types';
import { formatBytes } from '../../utils/format';
import { GlobalFileTypeExclusions } from '../../components/FileTypeExclusions';

export function BackupSettings({ value, onChange }: { value: AppSettings['backup']; onChange: (value: Partial<AppSettings['backup']>) => void }) {
  const { t, language } = useApp();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<StorageCheckResult>();
  const [error, setError] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserPath, setBrowserPath] = useState('');
  const [replication, setReplication] = useState<ReplicationStatus>();
  useEffect(() => {
    let active = true;
    const load = () => {
      api.getReplicationStatus()
        .then((status) => { if (active) setReplication(status); })
        .catch(() => { /* Status line is best effort. */ });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const [browseResult, setBrowseResult] = useState<StorageBrowseResult>();
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const ar = language === 'ar';
  const browse = async (path?: string) => {
    setBrowsing(true); setBrowseError('');
    try {
      const result = await api.browseStorage(path || undefined);
      setBrowseResult(result);
      setBrowserPath(result.path ?? path ?? '');
    } catch (caught) {
      setBrowseError(caught instanceof Error ? caught.message : (ar ? 'تعذر استعراض المجلد' : 'Could not browse folder'));
    } finally {
      setBrowsing(false);
    }
  };
  const openBrowser = () => {
    setBrowserOpen(true);
    void browse(value.destination ?? undefined);
  };
  const goToTypedPath = () => { void browse(browserPath.trim()); };
  const childPath = (name: string) => {
    const separator = browserPath.includes('\\') ? '\\' : '/';
    return `${browserPath.replace(/[\\/]+$/, '')}${separator}${name}`;
  };
  const runCheck = async () => {
    setChecking(true); setError('');
    try { setCheck(await api.checkStorage(value)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : (language === 'ar' ? 'تعذر فحص التخزين' : 'Storage check failed')); }
    finally { setChecking(false); }
  };
  const destinationStatus = (label: string, status: StorageCheckResult['primary']) => <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
    <p className="text-xs font-bold text-slate-200">{label}</p>
    <p className={`mt-1 text-xs ${status.available && status.writable ? 'text-orange-300' : 'text-rose-300'}`}>
      {status.configured ? status.available && status.writable ? (language === 'ar' ? 'متاح وقابل للكتابة' : 'Available and writable') : (language === 'ar' ? 'غير متاح' : 'Unavailable') : (language === 'ar' ? 'غير مُعدّ' : 'Not configured')}
    </p>
    {status.freeBytes !== null && <p className="mt-1 text-[11px] text-slate-400">{language === 'ar' ? 'متاح' : 'Free'}: {formatBytes(status.freeBytes, language)}{status.freePercent !== null ? ` · ${status.freePercent.toFixed(1)}%` : ''}</p>}
    {status.error && <p className="mt-1 break-words text-[11px] text-rose-300">{status.error}</p>}
  </div>;
  return <section className="surface p-5"><header className="mb-4"><h2 className="font-bold">{t('backupSettings')}</h2><p className="mt-1 text-xs text-slate-500">{ar ? 'يرسل Agent الملفات إلى الخادم عبر الـAPI؛ وجهة النسخ مسار محلي على الخادم ولا تحتاج إلى مشاركة شبكة.' : 'Agents upload files to the server through the API; the backup destination is a local server path and does not need a network share.'}</p></header>
    {check && <p className="mb-3 text-sm font-bold text-slate-200">{ar ? 'نتيجة اختبار الوجهات' : 'Destination test results'}</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label className="label">{ar ? 'الوجهة الأساسية على الخادم' : 'Primary server destination'}<div className="mt-1.5 flex gap-2"><input dir="ltr" className="input min-w-0 flex-1 text-left" value={value.destination ?? ''} onChange={(event) => onChange({ destination: event.target.value || null })} placeholder="E:\\LanVault-Backup" /><Button type="button" variant="outline" icon="folder" onClick={openBrowser}>{ar ? 'استعراض' : 'Browse'}</Button></div></label>
        {check && <div className="mt-2">{destinationStatus(ar ? 'الأساسية' : 'Primary', check.primary)}</div>}</div>
      <div><label className="label">{language === 'ar' ? 'نسخة ثانية على الخادم (اختياري)' : 'Secondary server destination (optional)'}<input dir="ltr" className="input mt-1.5 text-left" value={value.secondaryDestination ?? ''} onChange={(event) => onChange({ secondaryDestination: event.target.value || null })} placeholder="F:\\LanVault-Backup" /></label>
        {check && <div className="mt-2">{destinationStatus(ar ? 'الثانوية' : 'Secondary', check.secondary)}</div>}
        {replication?.secondaryConfigured && <p className="mt-2 text-[11px] text-slate-400">{replication.pending === 0 && replication.failed === 0
          ? (ar ? 'النسخ للوجهة الثانية: مكتمل' : 'Secondary replication: complete')
          : (ar ? `النسخ للوجهة الثانية: متبقي ${replication.pending} · فشل ${replication.failed}` : `Secondary replication: ${replication.pending} pending · ${replication.failed} failed`)}</p>}</div>
      <label className="label">{t('maxSpeed')}<input type="number" min="0.1" step="0.1" className="input mt-1.5" value={value.maxTransferRateMbps ?? ''} onChange={(event) => onChange({ maxTransferRateMbps: event.target.value ? Number(event.target.value) : null })} /></label>
      <label className="label">{t('retention')}<input type="number" min="1" max="1000" className="input mt-1.5" value={value.retentionCount ?? ''} onChange={(event) => onChange({ retentionCount: event.target.value ? Number(event.target.value) : null })} /></label>
      <label className="label">{language === 'ar' ? 'تنبيه عند انخفاض المساحة المتاحة إلى (%)' : 'Low free space alert threshold (%)'}<input type="number" min="1" max="50" className="input mt-1.5" value={value.lowSpaceThresholdPercent} onChange={(event) => onChange({ lowSpaceThresholdPercent: Number(event.target.value) || 1 })} /></label>
      <div className="flex items-end"><Button variant="outline" icon="refresh" onClick={() => void runCheck()} loading={checking}>{language === 'ar' ? 'اختبار الوصول والكتابة' : 'Test access and write'}</Button></div>
    </div>
    <GlobalFileTypeExclusions language={language} excludedExtensions={value.excludedExtensions ?? []}
      onChange={(excludedExtensions) => onChange({ excludedExtensions })} />

    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    <p className="mt-3 text-xs text-slate-500">{ar ? 'يرسل Agent الملفات إلى الخادم عبر اتصال LanVault، ثم يحفظها الخادم في هذا المجلد. لا يحتاج الجهاز إلى قرص E: أو مشاركة شبكة.' : 'Agents upload files over the LanVault connection; the server stores them in this folder. Client devices do not need an E: drive or a network share.'}</p>
    <Modal open={browserOpen} onClose={() => setBrowserOpen(false)} title={ar ? 'استعراض مجلد وجهة النسخ' : 'Browse backup destination'} size="lg">
      <p className="mb-3 text-xs text-slate-500">{ar ? 'يتم الاستعراض والكتابة على خادم LanVault. يمكن تحديد مجلد جديد وسيقوم اختبار الوصول أو أول رفع بإنشائه.' : 'Browse and write on the LanVault server. A new folder can be selected; the access test or first upload will create it.'}</p>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 font-mono text-xs" dir="ltr" value={browserPath} onChange={(event) => setBrowserPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') goToTypedPath(); }} placeholder="E:\\LanVault-Backup" />
        <Button type="button" variant="outline" icon="search" loading={browsing} onClick={goToTypedPath}>{ar ? 'فتح المسار' : 'Open path'}</Button>
      </div>
      {browseError && <p role="alert" className="mt-3 text-sm text-rose-600">{browseError}</p>}
      <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700">
        {browsing ? <p className="p-4 text-sm text-slate-500">{t('loading')}</p> : <>
          {browseResult?.parentPath && <button type="button" onClick={() => void browse(browseResult.parentPath ?? undefined)} className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-start text-sm font-semibold text-orange-600 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"><Icon name="arrowUpRight" size={16} />{ar ? 'المجلد الأعلى' : 'Parent folder'}</button>}
          {(browseResult?.roots ?? []).map((root) => <button key={root} type="button" onClick={() => void browse(root)} className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-start font-mono text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"><Icon name="folder" size={16} />{root}</button>)}
          {(browseResult?.directories ?? []).map((directory) => <button key={directory} type="button" onClick={() => void browse(childPath(directory))} className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-start text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"><Icon name="folder" size={16} />{directory}</button>)}
          {browseResult?.hasMore && <p className="p-3 text-xs text-amber-600">{ar ? 'يتم عرض أول 500 مجلد فقط. أدخل المسار كاملًا لاستعراض مجلد آخر.' : 'Showing the first 500 folders. Enter a full path to browse another folder.'}</p>}
          {browseResult?.path && browseResult.directories.length === 0 && <p className="p-4 text-sm text-slate-500">{ar ? 'لا توجد مجلدات فرعية.' : 'No subfolders.'}</p>}
        </>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setBrowserOpen(false)}>{t('cancel')}</Button>
        <Button type="button" icon="check" disabled={!browseResult?.path || browsing} onClick={() => { if (browseResult?.path) onChange({ destination: browseResult.path }); setBrowserOpen(false); }}>{ar ? 'اختيار هذا المجلد' : 'Use this folder'}</Button>
      </div>
    </Modal>
  </section>;
}
